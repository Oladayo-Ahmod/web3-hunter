import { getDb, schema } from "@web3-hunter/db";
import { createTestDatabase, type TestDatabase } from "@web3-hunter/db/testing";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ELIGIBILITY_GATE_FINGERPRINT } from "./apply-eligibility";
import { refreshJobEligibility } from "./job-eligibility-service";
import { jobFeedQuerySchema, listJobFeed } from "./job-query-service";
import { listOutreachTargets } from "./outreach-query-service";
import { seedCompany, seedJobPostedEvent } from "./test-support/seed";

async function insertJobEvent(input: {
  type: "JobUpdated" | "JobClosed";
  companyId: string;
  externalId: string;
  title: string;
  description?: string | null;
  occurredAt: Date;
}) {
  await getDb()
    .insert(schema.event)
    .values({
      type: input.type,
      category: "source",
      version: 1,
      sourceLabel: "test",
      occurredAt: input.occurredAt,
      relatedEntityType: "company",
      relatedEntityId: input.companyId,
      confidence: 1,
      metadata: {
        externalId: input.externalId,
        title: input.title,
        description: input.description ?? null,
        absoluteUrl: `https://example.test/jobs/${input.externalId}`,
        departmentNames: [],
      },
    });
}

async function storedVerdict(companyId: string, externalId: string) {
  const [row] = await getDb()
    .select()
    .from(schema.jobEligibility)
    .where(
      and(
        eq(schema.jobEligibility.companyId, companyId),
        eq(schema.jobEligibility.externalId, externalId),
      ),
    );
  return row;
}

const HOUR_MS = 60 * 60 * 1000;

describe("job eligibility verdicts (integration)", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    process.env.DATABASE_URL = testDb.connectionString;
  }, 60_000);

  afterAll(async () => {
    await testDb.stop();
  });

  it("stores a verdict and reason code for each open job", async () => {
    const company = await seedCompany({ slug: "verdict-co" });
    await seedJobPostedEvent({
      companyId: company.id,
      externalId: "good",
      title: "Smart Contract Engineer",
    });
    await seedJobPostedEvent({
      companyId: company.id,
      externalId: "bad",
      title: "Account Executive, Enterprise Sales",
    });

    await refreshJobEligibility();

    expect(await storedVerdict(company.id, "good")).toMatchObject({
      eligible: true,
      reasonCode: "ELIGIBLE_PROTOCOL_ENGINEERING",
      gateFingerprint: ELIGIBILITY_GATE_FINGERPRINT,
    });
    expect(await storedVerdict(company.id, "bad")).toMatchObject({
      eligible: false,
      reasonCode: "REJECT_NON_TECHNICAL",
    });
  });

  it("evaluates a generic title from its description", async () => {
    const company = await seedCompany({ slug: "description-co" });
    await seedJobPostedEvent({
      companyId: company.id,
      externalId: "generic",
      title: "Senior Software Engineer",
      description: "You will write Solidity smart contracts for our EVM rollup.",
    });

    await refreshJobEligibility();

    expect(await storedVerdict(company.id, "generic")).toMatchObject({ eligible: true });
  });

  it("is idempotent: once every verdict is current, a refresh evaluates nothing", async () => {
    await refreshJobEligibility();
    const second = await refreshJobEligibility();

    expect(second.evaluated).toBe(0);
  });

  it("re-evaluates a job when a newer event changes it", async () => {
    const company = await seedCompany({ slug: "updated-co" });
    const posted = new Date(Date.now() - 2 * HOUR_MS);
    await seedJobPostedEvent({
      companyId: company.id,
      externalId: "evolving",
      title: "Account Executive",
      occurredAt: posted,
    });
    await refreshJobEligibility();
    const before = await storedVerdict(company.id, "evolving");
    expect(before?.eligible).toBe(false);

    await insertJobEvent({
      type: "JobUpdated",
      companyId: company.id,
      externalId: "evolving",
      title: "Solidity Engineer",
      occurredAt: new Date(posted.getTime() + HOUR_MS),
    });
    const result = await refreshJobEligibility();
    const after = await storedVerdict(company.id, "evolving");

    expect(result.evaluated).toBe(1);
    expect(after?.eligible).toBe(true);
    expect(after?.stateEventId).not.toBe(before?.stateEventId);
  });

  it("does not evaluate a job that has been closed", async () => {
    const company = await seedCompany({ slug: "closed-co" });
    const posted = new Date(Date.now() - 3 * HOUR_MS);
    await seedJobPostedEvent({
      companyId: company.id,
      externalId: "gone",
      title: "Protocol Engineer",
      occurredAt: posted,
    });
    await insertJobEvent({
      type: "JobClosed",
      companyId: company.id,
      externalId: "gone",
      title: "Protocol Engineer",
      occurredAt: new Date(posted.getTime() + HOUR_MS),
    });

    await refreshJobEligibility();

    expect(await storedVerdict(company.id, "gone")).toBeUndefined();
  });

  it("re-evaluates every stored verdict when the gate's rules have changed", async () => {
    await refreshJobEligibility();
    const total = (await getDb().select().from(schema.jobEligibility)).length;
    expect(total).toBeGreaterThan(0);

    await getDb()
      .update(schema.jobEligibility)
      .set({ gateFingerprint: "rules-from-an-older-deploy" });
    const result = await refreshJobEligibility();

    expect(result.evaluated).toBe(total);
    const stale = (await getDb().select().from(schema.jobEligibility)).filter(
      (row) => row.gateFingerprint !== ELIGIBILITY_GATE_FINGERPRINT,
    );
    expect(stale).toHaveLength(0);
  });

  it("outreach reads the stored verdict rather than recomputing it from the job's text", async () => {
    const company = await seedCompany({ slug: "trust-verdict-co" });
    await seedJobPostedEvent({
      companyId: company.id,
      externalId: "trusted",
      title: "Smart Contract Engineer",
    });

    const first = (await listOutreachTargets()).find((t) => t.slug === "trust-verdict-co");
    expect(first?.openJobCount).toBe(1);

    // The gate would still call this job eligible. Only a reader that uses
    // the stored verdict can see the change.
    await getDb()
      .update(schema.jobEligibility)
      .set({ eligible: false })
      .where(eq(schema.jobEligibility.companyId, company.id));

    const second = (await listOutreachTargets()).find((t) => t.slug === "trust-verdict-co");
    expect(second?.openJobCount).toBe(0);
  });

  it("the job feed still returns each item's description without a viewer profile", async () => {
    const company = await seedCompany({ slug: "feed-description-co" });
    await seedJobPostedEvent({
      companyId: company.id,
      externalId: "described",
      title: "Blockchain Security Engineer",
      description: "Audit smart contracts and write the report.",
    });

    const result = await listJobFeed(jobFeedQuerySchema.parse({}));
    const item = result.items.find((entry) => entry.title === "Blockchain Security Engineer");

    expect(item?.description).toBe("Audit smart contracts and write the report.");
  });
});
