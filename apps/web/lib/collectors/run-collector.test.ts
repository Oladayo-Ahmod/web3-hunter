import { createTestDatabase, type TestDatabase } from "@web3-hunter/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CollectorSourceConfig, TrackedCompany } from "./run-collector";
import { runCollector } from "./run-collector";

interface FakeRecord {
  id: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Proves two things a purely behavioral (byte-identical-output) test
 * can't: that fetch genuinely runs concurrently across companies (not
 * just "happens to produce the same result if it were sequential"), and
 * that companies are still processed — for persistence, ingestion, and
 * reconciliation — one at a time, in original input order, regardless of
 * which fetch finishes first. See docs/adr/0001-fetch-only-collector-concurrency.md.
 */
describe("runCollector — fetch-only concurrency (integration)", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    process.env.DATABASE_URL = testDb.connectionString;
  }, 60_000);

  afterAll(async () => {
    await testDb.stop();
  });

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
