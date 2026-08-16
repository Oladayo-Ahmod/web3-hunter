import { createTestDatabase, type TestDatabase } from "@web3-hunter/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { jobFeedQuerySchema, listJobFeed } from "./job-query-service";
import { seedCompany, seedJobPostedEvent } from "./test-support/seed";

describe("listJobFeed (integration)", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    process.env.DATABASE_URL = testDb.connectionString;
  }, 60_000);

  afterAll(async () => {
    await testDb.stop();
  });

  it("excludes ineligible jobs from the default view (eligibleOnly: true)", async () => {
    const company = await seedCompany({ slug: "jobfeed-co" });
    await seedJobPostedEvent({
      companyId: company.id,
      externalId: "eligible-1",
      title: "Smart Contract Engineer",
    });
    await seedJobPostedEvent({
      companyId: company.id,
      externalId: "ineligible-1",
      title: "Executive Assistant",
    });

    const result = await listJobFeed(jobFeedQuerySchema.parse({}));
    const titles = result.items.map((item) => item.title);

    expect(titles).toContain("Smart Contract Engineer");
    expect(titles).not.toContain("Executive Assistant");
  });

  it("includes ineligible jobs when eligibleOnly is explicitly false", async () => {
    const company = await seedCompany({ slug: "jobfeed-co-2" });
    await seedJobPostedEvent({
      companyId: company.id,
      externalId: "ineligible-2",
      title: "Chief of Staff",
    });

    const result = await listJobFeed(jobFeedQuerySchema.parse({ eligibleOnly: false }));
    const titles = result.items.map((item) => item.title);

    expect(titles).toContain("Chief of Staff");
  });

  it("defaults to startup-first ordering: higher company priority sorts before lower/unset, ahead of plain freshness", async () => {
    const highPriority = await seedCompany({ slug: "jobfeed-high", priority: "high" });
    const noPriority = await seedCompany({ slug: "jobfeed-none" });

    // The no-priority Company's posting is more recent, but priority
    // should still win by default.
    await seedJobPostedEvent({
      companyId: highPriority.id,
      externalId: "job-a",
      title: "Protocol Engineer",
      occurredAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
    });
    await seedJobPostedEvent({
      companyId: noPriority.id,
      externalId: "job-b",
      title: "Blockchain Engineer",
      occurredAt: new Date(),
    });

    const result = await listJobFeed(jobFeedQuerySchema.parse({}));
    const indexOfHigh = result.items.findIndex((item) => item.company.slug === "jobfeed-high");
    const indexOfNone = result.items.findIndex((item) => item.company.slug === "jobfeed-none");

    expect(indexOfHigh).toBeGreaterThanOrEqual(0);
    expect(indexOfNone).toBeGreaterThanOrEqual(0);
    expect(indexOfHigh).toBeLessThan(indexOfNone);
  });

  it("carries the Company's priority through to each JobFeedItemDTO", async () => {
    const company = await seedCompany({ slug: "jobfeed-priority-carry", priority: "medium" });
    await seedJobPostedEvent({
      companyId: company.id,
      externalId: "job-c",
      title: "Solidity Engineer",
    });

    const result = await listJobFeed(jobFeedQuerySchema.parse({}));
    const item = result.items.find((i) => i.company.slug === "jobfeed-priority-carry");

    expect(item?.company.priority).toBe("medium");
  });
});
