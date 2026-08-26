import { getDb, schema } from "@web3-hunter/db";
import { createTestDatabase, type TestDatabase } from "@web3-hunter/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CollectorSourceConfig, TrackedCompany } from "./run-collector";
import { runCollector } from "./run-collector";

interface FakeRecord {
  id: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// One shared test database for the whole file — `getDb()` caches its
// connection pool as a module-level singleton on first use (see
// packages/db/src/client.ts), so a second `createTestDatabase()` call
// later in the same process would be invisible to it; every describe
// block below shares this one instance instead, the same way every other
// multi-describe integration test file in this repo does.
let testDb: TestDatabase;

beforeAll(async () => {
  testDb = await createTestDatabase();
  process.env.DATABASE_URL = testDb.connectionString;
}, 60_000);

afterAll(async () => {
  await testDb.stop();
});

/**
 * Proves two things a purely behavioral (byte-identical-output) test
 * can't: that fetch genuinely runs concurrently across companies (not
 * just "happens to produce the same result if it were sequential"), and
 * that companies are still processed — for persistence, ingestion, and
 * reconciliation — one at a time, in original input order, regardless of
 * which fetch finishes first. See docs/adr/0001-fetch-only-collector-concurrency.md.
 */
describe("runCollector — fetch-only concurrency (integration)", () => {
  const FETCH_DELAY_MS = 100;

  function makeConfig(fetchStartTimes: number[]): CollectorSourceConfig<FakeRecord> {
    return {
      slug: "fake-concurrency-test-collector",
      sourceType: "test",
      fetchRecords: async (sourceIdentifier) => {
        fetchStartTimes.push(Date.now());
        await sleep(FETCH_DELAY_MS);
        return [{ id: `${sourceIdentifier}-record` }];
      },
      externalIdOf: (record) => record.id,
      createNormalizer: () => () => null,
      createClosedNormalizer: () => () => null,
    };
  }

  it("fetches multiple companies concurrently rather than one at a time", async () => {
    const companies: TrackedCompany[] = Array.from({ length: 4 }, (_, i) => ({
      companySlug: `concurrency-co-${i}`,
      companyName: `Concurrency Co ${i}`,
      sourceIdentifier: `concurrency-co-${i}`,
    }));

    const fetchStartTimes: number[] = [];
    const results = await runCollector(makeConfig(fetchStartTimes), companies);

    expect(results).toHaveLength(4);
    expect(results.every((r) => r.status === "ok")).toBe(true);
    expect(fetchStartTimes).toHaveLength(4);

    // The precise, DB-overhead-independent proof of concurrency: all four
    // fetches should have *started* within a small window of each other,
    // not staggered ~FETCH_DELAY_MS apart the way sequential execution
    // would produce. (A wall-clock total-duration threshold was
    // considered and rejected here — the sequential persist/ingest/
    // reconcile phase's own real database round-trips dominate total time
    // in a fast test environment, making a duration-based assertion noisy
    // and not actually about what this test is proving.)
    //
    // Threshold is 2x FETCH_DELAY_MS, not 1x: sequential execution would
    // need at least 4x FETCH_DELAY_MS (400ms) for all four starts to
    // spread out, so 2x still clearly distinguishes concurrent from
    // sequential while tolerating scheduling jitter under a loaded test
    // suite (observed up to ~190ms spread when the full suite runs in
    // parallel, well under the 400ms a sequential run would produce).
    const spread = Math.max(...fetchStartTimes) - Math.min(...fetchStartTimes);
    expect(spread).toBeLessThan(2 * FETCH_DELAY_MS);
  });

  it("returns results in original input order regardless of fetch completion order", async () => {
    const companies: TrackedCompany[] = [
      { companySlug: "order-a", companyName: "Order A", sourceIdentifier: "order-a" },
      { companySlug: "order-b", companyName: "Order B", sourceIdentifier: "order-b" },
      { companySlug: "order-c", companyName: "Order C", sourceIdentifier: "order-c" },
    ];

    const results = await runCollector(makeConfig([]), companies);

    expect(results.map((r) => r.companySlug)).toEqual(["order-a", "order-b", "order-c"]);
  });

  it("isolates one company's fetch failure from the others, exactly as before this milestone", async () => {
    const config: CollectorSourceConfig<FakeRecord> = {
      slug: "fake-concurrency-failure-collector",
      sourceType: "test",
      fetchRecords: async (sourceIdentifier) => {
        if (sourceIdentifier === "broken") {
          throw new Error("simulated fetch failure");
        }
        return [{ id: `${sourceIdentifier}-record` }];
      },
      externalIdOf: (record) => record.id,
      createNormalizer: () => () => null,
      createClosedNormalizer: () => () => null,
    };

    const companies: TrackedCompany[] = [
      { companySlug: "broken-co", companyName: "Broken Co", sourceIdentifier: "broken" },
      { companySlug: "healthy-co", companyName: "Healthy Co", sourceIdentifier: "healthy" },
    ];

    const results = await runCollector(config, companies);

    expect(results[0]).toMatchObject({ companySlug: "broken-co", status: "error" });
    expect(results[1]).toMatchObject({ companySlug: "healthy-co", status: "ok" });
  });
});

/**
 * Milestone 25 (governing directive Part C) — a real production audit
 * found a handful of permanently dead company boards (404s from a
 * renamed/removed ATS board) holding a Collector's `lastRunAt` frozen for
 * *weeks* even while every other tracked Company kept publishing fresh
 * job data run after run, because the previous health-recording logic
 * only ever advanced `lastRunAt` on a zero-error run. These tests pin
 * down the fix directly against the `collector` table, not just the
 * function's return value.
 */
describe("runCollector — health semantics: successful / partial / failed runs", () => {
  async function getCollectorHealth(slug: string) {
    const [row] = await getDb()
      .select()
      .from(schema.collector)
      .where(eq(schema.collector.slug, slug));
    return row;
  }

  function makeConfig(
    slug: string,
    brokenIdentifiers: readonly string[],
  ): CollectorSourceConfig<FakeRecord> {
    return {
      slug,
      sourceType: "test",
      fetchRecords: async (sourceIdentifier) => {
        if (brokenIdentifiers.includes(sourceIdentifier)) {
          throw new Error(`simulated 404 for permanently dead board "${sourceIdentifier}"`);
        }
        return [{ id: `${sourceIdentifier}-record` }];
      },
      externalIdOf: (record) => record.id,
      createNormalizer: () => () => null,
      createClosedNormalizer: () => () => null,
    };
  }

  it("a fully successful run: status active, lastRunAt set, consecutiveFailures reset to 0", async () => {
    const slug = "health-test-successful";
    const companies: TrackedCompany[] = [
      { companySlug: "co-a", companyName: "Co A", sourceIdentifier: "co-a" },
      { companySlug: "co-b", companyName: "Co B", sourceIdentifier: "co-b" },
    ];

    await runCollector(makeConfig(slug, []), companies);
    const health = await getCollectorHealth(slug);

    expect(health?.status).toBe("active");
    expect(health?.lastRunAt).not.toBeNull();
    expect(health?.consecutiveFailures).toBe(0);
  });

  it("a PARTIAL run (some companies permanently broken, most healthy): lastRunAt still advances", async () => {
    const slug = "health-test-partial";
    const companies: TrackedCompany[] = [
      { companySlug: "dead-board", companyName: "Dead Board Co", sourceIdentifier: "dead-board" },
      { companySlug: "co-a", companyName: "Co A", sourceIdentifier: "co-a" },
      { companySlug: "co-b", companyName: "Co B", sourceIdentifier: "co-b" },
    ];

    await runCollector(makeConfig(slug, ["dead-board"]), companies);
    const firstRunHealth = await getCollectorHealth(slug);

    // The real bug: this must be a *recent* timestamp, not null/stale,
    // even though this run had an error and status is "degraded".
    expect(firstRunHealth?.status).toBe("degraded");
    expect(firstRunHealth?.lastRunAt).not.toBeNull();
    const firstRunAt = firstRunHealth!.lastRunAt!.getTime();
    expect(Date.now() - firstRunAt).toBeLessThan(5_000);

    // Run it again — a still-dead board must keep advancing lastRunAt on
    // every subsequent partial run too, not just the first one.
    await new Promise((resolve) => setTimeout(resolve, 10));
    await runCollector(makeConfig(slug, ["dead-board"]), companies);
    const secondRunHealth = await getCollectorHealth(slug);

    expect(secondRunHealth?.lastRunAt!.getTime()).toBeGreaterThan(firstRunAt);
    expect(secondRunHealth?.consecutiveFailures).toBe(2);
  });

  it("a FAILED run (every tracked company fails): lastRunAt does NOT advance — this is the only genuinely stale case", async () => {
    const slug = "health-test-failed";
    const companies: TrackedCompany[] = [
      { companySlug: "dead-a", companyName: "Dead A", sourceIdentifier: "dead-a" },
      { companySlug: "dead-b", companyName: "Dead B", sourceIdentifier: "dead-b" },
    ];

    // First, a clean run to establish a baseline lastRunAt.
    await runCollector(makeConfig(slug, []), companies);
    const baseline = await getCollectorHealth(slug);
    const baselineRunAt = baseline!.lastRunAt!.getTime();

    await new Promise((resolve) => setTimeout(resolve, 10));

    // Now every tracked company fails — a systemic outage, not a couple
    // of dead boards mixed into an otherwise-healthy run.
    await runCollector(makeConfig(slug, ["dead-a", "dead-b"]), companies);
    const afterTotalFailure = await getCollectorHealth(slug);

    expect(afterTotalFailure?.status).toBe("degraded");
    expect(afterTotalFailure?.lastRunAt!.getTime()).toBe(baselineRunAt);
    expect(afterTotalFailure?.consecutiveFailures).toBe(1);
  });
});
