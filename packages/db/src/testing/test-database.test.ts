import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedSkillTaxonomy, SKILL_TAXONOMY } from "../seed/skill-taxonomy";
import {
  collector,
  company,
  event,
  opportunity,
  opportunitySkill,
  rawRecord,
  skill,
} from "../schema";
import { createTestDatabase, type TestDatabase } from "./test-database";

describe("createTestDatabase", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    testDb = await createTestDatabase();
  }, 60_000);

  afterAll(async () => {
    await testDb.stop();
  });

  it("applies every migration, including the append-only enforcement triggers", async () => {
    const tables = await testDb.db.execute(
      sql`select table_name from information_schema.tables where table_schema = 'public' order by table_name`,
    );

    expect(tables.map((row) => row.table_name)).toEqual([
      "account",
      "classification_ledger",
      "collector",
      "company",
      "company_intelligence",
      "company_source_identity",
      "company_summary",
      "company_technology_profile",
      "event",
      "event_provenance",
      "job_classification_ledger",
      "job_skill",
      "match",
      "opportunity",
      "opportunity_skill",
      "opportunity_summary",
      "outreach_draft",
      "pipeline_run",
      "profile_insight",
      "raw_record",
      "raw_record_ingestion",
      "recommendation",
      "recommendation_explanation",
      "session",
      "signal",
      "signal_generation_ledger",
      "skill",
      "system_health_check",
      "technology_detection",
      "technology_detection_ledger",
      "user",
      "user_profile",
      "user_skill",
      "verification",
    ]);
  });

  it("allows inserting a row into the event table", async () => {
    const [inserted] = await testDb.db
      .insert(collector)
      .values({ slug: "test-collector", sourceType: "test" })
      .returning();

    expect(inserted).toBeDefined();

    const [row] = await testDb.db
      .insert(event)
      .values({
        type: "TestEvent",
        category: "source",
        version: 1,
        collectorId: inserted!.id,
        occurredAt: new Date(),
        confidence: 1,
        metadata: { hello: "world" },
      })
      .returning();

    expect(row?.type).toBe("TestEvent");
  });

  it("rejects UPDATE against the event table at the database level", async () => {
    const rows = await testDb.db.select().from(event).limit(1);
    const target = rows[0];
    expect(target).toBeDefined();

    const error: unknown = await testDb.db
      .execute(sql`update "event" set "type" = 'Mutated' where "id" = ${target!.id}`)
      .catch((caught: unknown) => caught);

    expect(String((error as { cause?: unknown }).cause ?? error)).toMatch(/append-only/i);
  });

  it("rejects DELETE against the event table at the database level", async () => {
    const rows = await testDb.db.select().from(event).limit(1);
    const target = rows[0];
    expect(target).toBeDefined();

    const error: unknown = await testDb.db
      .execute(sql`delete from "event" where "id" = ${target!.id}`)
      .catch((caught: unknown) => caught);

    expect(String((error as { cause?: unknown }).cause ?? error)).toMatch(/append-only/i);
  });

  it("rejects UPDATE and DELETE against the raw_record table at the database level", async () => {
    const [inserted] = await testDb.db
      .insert(collector)
      .values({ slug: "raw-record-test-collector", sourceType: "test" })
      .returning();

    const [row] = await testDb.db
      .insert(rawRecord)
      .values({ collectorId: inserted!.id, contentHash: "abc123", payload: { hello: "world" } })
      .returning();

    const updateError: unknown = await testDb.db
      .execute(sql`update "raw_record" set "content_hash" = 'mutated' where "id" = ${row!.id}`)
      .catch((caught: unknown) => caught);
    expect(String((updateError as { cause?: unknown }).cause ?? updateError)).toMatch(
      /append-only/i,
    );

    const deleteError: unknown = await testDb.db
      .execute(sql`delete from "raw_record" where "id" = ${row!.id}`)
      .catch((caught: unknown) => caught);
    expect(String((deleteError as { cause?: unknown }).cause ?? deleteError)).toMatch(
      /append-only/i,
    );
  });

  it("rejects UPDATE and DELETE against the opportunity_skill table at the database level", async () => {
    const [testCompany] = await testDb.db
      .insert(company)
      .values({ slug: "opportunity-skill-test-co", name: "Opportunity Skill Test Co" })
      .returning();
    const [testOpportunity] = await testDb.db
      .insert(opportunity)
      .values({
        id: crypto.randomUUID(),
        companyId: testCompany!.id,
        opportunityType: "engineering-hiring-surge",
        detectionWindow: "2026-W01",
        reasoning: "test",
        detectedAt: new Date(),
      })
      .returning();
    const [testSkill] = await testDb.db
      .insert(skill)
      .values({ slug: "opportunity-skill-test-skill", name: "Test Skill" })
      .returning();

    const [row] = await testDb.db
      .insert(opportunitySkill)
      .values({
        id: crypto.randomUUID(),
        opportunityId: testOpportunity!.id,
        skillId: testSkill!.id,
        confidence: 0.6,
        reasoning: "test",
        sourceEventIds: [crypto.randomUUID()],
        detectedAt: new Date(),
      })
      .returning();

    const updateError: unknown = await testDb.db
      .execute(sql`update "opportunity_skill" set "confidence" = 0.9 where "id" = ${row!.id}`)
      .catch((caught: unknown) => caught);
    expect(String((updateError as { cause?: unknown }).cause ?? updateError)).toMatch(
      /append-only/i,
    );

    const deleteError: unknown = await testDb.db
      .execute(sql`delete from "opportunity_skill" where "id" = ${row!.id}`)
      .catch((caught: unknown) => caught);
    expect(String((deleteError as { cause?: unknown }).cause ?? deleteError)).toMatch(
      /append-only/i,
    );
  });

  it("seeds the Skill taxonomy idempotently", async () => {
    await seedSkillTaxonomy(testDb.db);
    await seedSkillTaxonomy(testDb.db);

    const rows = await testDb.db.select().from(skill);
    const seededSlugs = rows
      .map((r) => r.slug)
      .filter((slug) => SKILL_TAXONOMY.some((s) => s.slug === slug));
    expect(seededSlugs).toHaveLength(SKILL_TAXONOMY.length);
  });
});
