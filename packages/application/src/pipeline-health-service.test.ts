import { getDb, schema } from "@web3-hunter/db";
import { createTestDatabase, type TestDatabase } from "@web3-hunter/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getPipelineHealth } from "./pipeline-health-service";
import { seedCompany, seedJobPostedEvent } from "./test-support/seed";

async function seedCollector(input: {
  slug: string;
  sourceType?: string;
  status?: "configured" | "active" | "degraded" | "disabled";
  lastRunAt?: Date | null;
  consecutiveFailures?: number;
}) {
  const db = getDb();
  const [row] = await db
    .insert(schema.collector)
    .values({
      slug: input.slug,
      sourceType: input.sourceType ?? "ats",
      status: input.status ?? "active",
      lastRunAt: input.lastRunAt ?? null,
      consecutiveFailures: input.consecutiveFailures ?? 0,
    })
    .returning();
  return row!;
}

describe("getPipelineHealth (integration)", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    process.env.DATABASE_URL = testDb.connectionString;
  }, 60_000);

  afterAll(async () => {
    await testDb.stop();
  });

  it("reports no known freshness when there are no JobPosted/JobUpdated Events yet", async () => {
    const health = await getPipelineHealth();
    expect(health.jobsLastRefreshedAt).toBeNull();
    expect(health.jobsAreStale).toBe(true);
  });

  it("reports jobs as fresh when the most recent job Event is within the staleness threshold", async () => {
    const company = await seedCompany({ slug: "fresh-jobs-co" });
    await seedJobPostedEvent({
      companyId: company.id,
      externalId: "recent-1",
      title: "Smart Contract Engineer",
      occurredAt: new Date(),
    });

    const health = await getPipelineHealth();
    expect(health.jobsAreStale).toBe(false);
    expect(health.jobsLastRefreshedAt).not.toBeNull();
  });

  it("flags a Collector whose last successful run is well outside its expected cadence as stale", async () => {
    const twoWeeksAgo = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000);
    await seedCollector({ slug: "greenhouse", lastRunAt: twoWeeksAgo });
    await seedCollector({ slug: "lever", lastRunAt: new Date() });

    const health = await getPipelineHealth();
    const greenhouse = health.collectors.find((c) => c.slug === "greenhouse");
    const lever = health.collectors.find((c) => c.slug === "lever");

    expect(greenhouse?.isStale).toBe(true);
    expect(lever?.isStale).toBe(false);
  });

  it("flags a Collector that has never run as stale", async () => {
    await seedCollector({ slug: "ashby", lastRunAt: null, status: "configured" });

    const health = await getPipelineHealth();
    const ashby = health.collectors.find((c) => c.slug === "ashby");

    expect(ashby?.isStale).toBe(true);
  });

  it("reports a recently successful DefiLlama run as fresh, then flags it stale once past its 48h (once-daily x2) threshold", async () => {
    const twentySevenHoursAgo = new Date(Date.now() - 27 * 60 * 60 * 1000); // one missed daily run, still within 48h
    await seedCollector({
      slug: "defillama",
      sourceType: "security-intelligence",
      lastRunAt: new Date(),
    });

    const freshHealth = await getPipelineHealth();
    expect(freshHealth.collectors.find((c) => c.slug === "defillama")?.isStale).toBe(false);

    // A single missed daily run (27h, more than 24h but well under the
    // 48h threshold) must not false-alarm — exactly the gap Stage 7 found.
    await getDb()
      .update(schema.collector)
      .set({ lastRunAt: twentySevenHoursAgo })
      .where(eq(schema.collector.slug, "defillama"));
    const oneMissedRunHealth = await getPipelineHealth();
    expect(oneMissedRunHealth.collectors.find((c) => c.slug === "defillama")?.isStale).toBe(false);

    const fortyNineHoursAgo = new Date(Date.now() - 49 * 60 * 60 * 1000); // past the 48h threshold
    await getDb()
      .update(schema.collector)
      .set({ lastRunAt: fortyNineHoursAgo })
      .where(eq(schema.collector.slug, "defillama"));
    const staleHealth = await getPipelineHealth();
    expect(staleHealth.collectors.find((c) => c.slug === "defillama")?.isStale).toBe(true);
  });

  it("reports a recently successful Immunefi run as fresh, then flags it stale once past its 48h (once-daily x2) threshold", async () => {
    await seedCollector({
      slug: "immunefi",
      sourceType: "security-intelligence",
      lastRunAt: new Date(),
    });

    const freshHealth = await getPipelineHealth();
    expect(freshHealth.collectors.find((c) => c.slug === "immunefi")?.isStale).toBe(false);

    const fiftyHoursAgo = new Date(Date.now() - 50 * 60 * 60 * 1000);
    await getDb()
      .update(schema.collector)
      .set({ lastRunAt: fiftyHoursAgo })
      .where(eq(schema.collector.slug, "immunefi"));
    const staleHealth = await getPipelineHealth();
    expect(staleHealth.collectors.find((c) => c.slug === "immunefi")?.isStale).toBe(true);
  });

  it("leaves the existing greenhouse/lever/ashby/github thresholds unchanged by the new defillama/immunefi entries", async () => {
    const fifteenHoursAgo = new Date(Date.now() - 15 * 60 * 60 * 1000); // stale for a 14h threshold, fresh for 30h/48h
    await seedCollector({ slug: "greenhouse-unchanged", lastRunAt: fifteenHoursAgo });

    const health = await getPipelineHealth();
    const greenhouse = health.collectors.find((c) => c.slug === "greenhouse-unchanged");

    // Still gated by its own 14h threshold, not accidentally widened.
    expect(greenhouse?.isStale).toBe(true);
  });
});
