import { getDb, schema, seedSkillTaxonomy } from "@web3-hunter/db";
import { createTestDatabase, type TestDatabase } from "@web3-hunter/db/testing";
import { publishEvent, registerEventType } from "@web3-hunter/events";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { runClassificationPipeline } from "./run-classification-pipeline";
import "./classifiers/skill-classifier";

// A local stand-in for the real "JobPosted" Event Type packages/collectors/
// greenhouse registers — packages/classification never depends on
// packages/collectors, per docs/ARCHITECTURE.md §3.
const TestJobPosted = registerEventType({
  name: "JobPosted",
  category: "source",
  version: 1,
  metadataSchema: z.object({ title: z.string(), departmentNames: z.array(z.string()) }),
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

async function seedOpportunity(companyId: string) {
  const db = getDb();
  const [opportunity] = await db
    .insert(schema.opportunity)
    .values({
      id: crypto.randomUUID(),
      companyId,
      opportunityType: "engineering-hiring-surge",
      detectionWindow: "2026-W01",
      reasoning: "test",
      detectedAt: new Date("2026-01-01T00:00:00Z"),
    })
    .returning();
  return opportunity!.id;
}

async function publishJobPosted(input: {
  collectorId: string;
  companyId: string;
  title: string;
  departmentNames?: string[];
}) {
  const event = await publishEvent({
    type: TestJobPosted.name,
    metadata: { title: input.title, departmentNames: input.departmentNames ?? ["Engineering"] },
    occurredAt: new Date("2026-01-01T00:00:00Z"),
    confidence: 1,
    collectorId: input.collectorId,
    relatedEntityType: "company",
    relatedEntityId: input.companyId,
  });
  return event.id;
}

describe("runClassificationPipeline (integration)", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    process.env.DATABASE_URL = testDb.connectionString;
    await seedSkillTaxonomy(getDb());
  }, 60_000);

  afterAll(async () => {
    await testDb.stop();
  });

  it("classifies an Opportunity's Skills from its Company's JobPosted Events", async () => {
    const { collectorId, companyId } = await seedCollectorAndCompany("acme-classify");
    const opportunityId = await seedOpportunity(companyId);
    const eventId = await publishJobPosted({
      collectorId,
      companyId,
      title: "Senior Solidity Engineer",
    });

    const result = await runClassificationPipeline(opportunityId);
    expect(result.eventsProcessed).toBe(1);
    expect(result.classificationsProduced).toBeGreaterThanOrEqual(1);

    const rows = await getDb()
      .select()
      .from(schema.opportunitySkill)
      .where(eq(schema.opportunitySkill.opportunityId, opportunityId));
    const solidityRow = rows.find((row) => row.reasoning.includes("Solidity"));
    expect(solidityRow).toBeDefined();
    expect(solidityRow?.sourceEventIds).toEqual([eventId]);
  });

  it("does not create a row when nothing matches the taxonomy", async () => {
    const { collectorId, companyId } = await seedCollectorAndCompany("acme-no-match");
    const opportunityId = await seedOpportunity(companyId);
    await publishJobPosted({ collectorId, companyId, title: "Head of Marketing" });

    const result = await runClassificationPipeline(opportunityId);
    expect(result.eventsProcessed).toBe(1);
    expect(result.classificationsProduced).toBe(0);
  });

  it("is idempotent: re-running with no new Events changes nothing", async () => {
    const { collectorId, companyId } = await seedCollectorAndCompany("acme-idempotent-classify");
    const opportunityId = await seedOpportunity(companyId);
    await publishJobPosted({ collectorId, companyId, title: "Rust Engineer" });

    const first = await runClassificationPipeline(opportunityId);
    const second = await runClassificationPipeline(opportunityId);

    expect(first.eventsProcessed).toBe(1);
    expect(second.eventsProcessed).toBe(0);
    expect(second.classificationsProduced).toBe(0);
  });

  it("throws for an unknown Opportunity", async () => {
    await expect(runClassificationPipeline(crypto.randomUUID())).rejects.toThrow(/not found/i);
  });
});
