import { getDb, schema } from "@web3-hunter/db";
import { createTestDatabase, type TestDatabase } from "@web3-hunter/db/testing";
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
});
