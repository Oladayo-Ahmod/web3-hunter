import { getDb, schema, seedSkillTaxonomy } from "@web3-hunter/db";
import { createTestDatabase, type TestDatabase } from "@web3-hunter/db/testing";
import { publishEvent, registerEventType } from "@web3-hunter/events";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { runJobClassificationPipeline } from "./run-job-classification-pipeline";
import "./classifiers/skill-classifier";

// A local stand-in for the real "JobPosted" Event Type packages/collectors/
// greenhouse registers — packages/classification never depends on
// packages/collectors, per docs/ARCHITECTURE.md §3.
const TestJobPosted = registerEventType({
  name: "JobPosted",
  category: "source",
  version: 1,
  metadataSchema: z.object({
    externalId: z.string(),
    title: z.string(),
    departmentNames: z.array(z.string()),
  }),
});

async function seedCollectorAndCompany(slug: string) {
  const db = getDb();
  const [collector] = await db
    .insert(schema.collector)
    .values({ slug: `${slug}-collector`, sourceType: "test" })
    .returning();
  const [company] = await db.insert(schema.company).values({ slug, name: slug }).returning();
  return { collectorId: collector!.id, companyId: company!.id };
}

async function publishJobPosted(input: {
  collectorId: string;
  companyId: string;
  externalId: string;
  title: string;
  departmentNames?: string[];
}) {
  const event = await publishEvent({
    type: TestJobPosted.name,
    metadata: {
      externalId: input.externalId,
      title: input.title,
      departmentNames: input.departmentNames ?? ["Engineering"],
    },
    occurredAt: new Date("2026-01-01T00:00:00Z"),
    confidence: 1,
    collectorId: input.collectorId,
    relatedEntityType: "company",
    relatedEntityId: input.companyId,
  });
  return event.id;
}

describe("runJobClassificationPipeline (integration)", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    process.env.DATABASE_URL = testDb.connectionString;
    await seedSkillTaxonomy(getDb());
  }, 60_000);

  afterAll(async () => {
    await testDb.stop();
  });

  it("classifies an individual Job's Skills from its own JobPosted Event — no Opportunity required", async () => {
    const { collectorId, companyId } = await seedCollectorAndCompany("acme-job-classify");
    const eventId = await publishJobPosted({
      collectorId,
      companyId,
      externalId: "job-1",
      title: "Senior Solidity Engineer",
    });

    const result = await runJobClassificationPipeline(companyId);
    expect(result.eventsProcessed).toBe(1);
    expect(result.classificationsProduced).toBeGreaterThanOrEqual(1);

    const rows = await getDb()
      .select()
      .from(schema.jobSkill)
      .where(
        and(eq(schema.jobSkill.companyId, companyId), eq(schema.jobSkill.externalId, "job-1")),
      );
    const solidityRow = rows.find((row) => row.reasoning.includes("Solidity"));
    expect(solidityRow).toBeDefined();
    expect(solidityRow?.sourceEventIds).toEqual([eventId]);
  });

  it("classifies each Job under a Company separately, keyed by externalId", async () => {
    const { collectorId, companyId } = await seedCollectorAndCompany("acme-multi-job");
    await publishJobPosted({
      collectorId,
      companyId,
      externalId: "job-a",
      title: "Solidity Engineer",
    });
    await publishJobPosted({
      collectorId,
      companyId,
      externalId: "job-b",
      title: "Head of Marketing",
    });

    const result = await runJobClassificationPipeline(companyId);
    expect(result.eventsProcessed).toBe(2);

    const jobASkills = await getDb()
      .select()
      .from(schema.jobSkill)
      .where(
        and(eq(schema.jobSkill.companyId, companyId), eq(schema.jobSkill.externalId, "job-a")),
      );
    const jobBSkills = await getDb()
      .select()
      .from(schema.jobSkill)
      .where(
        and(eq(schema.jobSkill.companyId, companyId), eq(schema.jobSkill.externalId, "job-b")),
      );

    expect(jobASkills.length).toBeGreaterThanOrEqual(1);
    expect(jobBSkills.length).toBe(0);
  });

  it("does not create a row when nothing matches the taxonomy", async () => {
    const { collectorId, companyId } = await seedCollectorAndCompany("acme-job-no-match");
    await publishJobPosted({
      collectorId,
      companyId,
      externalId: "job-1",
      title: "Head of Marketing",
    });

    const result = await runJobClassificationPipeline(companyId);
    expect(result.eventsProcessed).toBe(1);
    expect(result.classificationsProduced).toBe(0);
  });

  it("is idempotent: re-running with no new Events changes nothing", async () => {
    const { collectorId, companyId } = await seedCollectorAndCompany("acme-job-idempotent");
    await publishJobPosted({
      collectorId,
      companyId,
      externalId: "job-1",
      title: "Rust Engineer",
    });

    const first = await runJobClassificationPipeline(companyId);
    const second = await runJobClassificationPipeline(companyId);

    expect(first.eventsProcessed).toBe(1);
    expect(second.eventsProcessed).toBe(0);
    expect(second.classificationsProduced).toBe(0);
  });

  it("does not classify another Company's Jobs", async () => {
    const companyA = await seedCollectorAndCompany("acme-scope-a");
    const companyB = await seedCollectorAndCompany("acme-scope-b");
    await publishJobPosted({
      collectorId: companyA.collectorId,
      companyId: companyA.companyId,
      externalId: "job-1",
      title: "Solidity Engineer",
    });

    const result = await runJobClassificationPipeline(companyB.companyId);
    expect(result.eventsProcessed).toBe(0);
  });
});
