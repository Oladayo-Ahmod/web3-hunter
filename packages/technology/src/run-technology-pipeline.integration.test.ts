import { getDb, schema, seedSkillTaxonomy } from "@web3-hunter/db";
import { createTestDatabase, type TestDatabase } from "@web3-hunter/db/testing";
import { publishEvent, registerEventType } from "@web3-hunter/events";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import "./detectors/language-topic-detector";
import { rebuildCompanyTechnologyProfile } from "./company-technology-profile-store";
import { runTechnologyPipeline } from "./run-technology-pipeline";

// A local stand-in for the real "RepositoryDiscovered" Event Type
// packages/collectors/github registers — packages/technology never
// depends on packages/collectors, per docs/ARCHITECTURE.md §3.
const TestRepositoryDiscovered = registerEventType({
  name: "RepositoryDiscovered",
  category: "source",
  version: 1,
  metadataSchema: z.object({
    fullName: z.string(),
    language: z.string().nullable(),
    topics: z.array(z.string()),
  }),
});

// A local stand-in for a Hiring Event, to prove Technology detection
// harmlessly ignores Source Events it doesn't understand rather than
// requiring a filtered query.
const TestJobPosted = registerEventType({
  name: "JobPosted",
  category: "source",
  version: 1,
  metadataSchema: z.object({ title: z.string() }),
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

async function publishRepository(input: {
  collectorId: string;
  companyId: string;
  fullName: string;
  language: string | null;
  topics?: string[];
  occurredAt?: Date;
}) {
  const event = await publishEvent({
    type: TestRepositoryDiscovered.name,
    metadata: { fullName: input.fullName, language: input.language, topics: input.topics ?? [] },
    occurredAt: input.occurredAt ?? new Date("2026-01-01T00:00:00Z"),
    confidence: 1,
    collectorId: input.collectorId,
    relatedEntityType: "company",
    relatedEntityId: input.companyId,
  });
  return event.id;
}

async function publishJobPosted(input: { collectorId: string; companyId: string; title: string }) {
  await publishEvent({
    type: TestJobPosted.name,
    metadata: { title: input.title },
    occurredAt: new Date("2026-01-01T00:00:00Z"),
    confidence: 1,
    collectorId: input.collectorId,
    relatedEntityType: "company",
    relatedEntityId: input.companyId,
  });
}

describe("runTechnologyPipeline (integration)", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    process.env.DATABASE_URL = testDb.connectionString;
    await seedSkillTaxonomy(getDb());
  }, 60_000);

  afterAll(async () => {
    await testDb.stop();
  });

  it("detects a Skill from a repository's primary language and updates the Company Technology Profile", async () => {
    const { collectorId, companyId } = await seedCollectorAndCompany("acme-tech");
    const eventId = await publishRepository({
      collectorId,
      companyId,
      fullName: "acme/protocol-node",
      language: "Rust",
    });

    const result = await runTechnologyPipeline(companyId);
    expect(result.eventsProcessed).toBe(1);
    expect(result.detectionsProduced).toBeGreaterThanOrEqual(1);
    expect(result.profileUpdated).toBe(true);

    const detectionRows = await getDb()
      .select()
      .from(schema.technologyDetection)
      .where(eq(schema.technologyDetection.companyId, companyId));
    const rustRow = detectionRows.find((row) => row.reasoning.includes("Rust"));
    expect(rustRow).toBeDefined();
    expect(rustRow?.sourceEventIds).toEqual([eventId]);

    const [profileRow] = await getDb()
      .select()
      .from(schema.companyTechnologyProfile)
      .where(eq(schema.companyTechnologyProfile.companyId, companyId));
    expect(profileRow?.skillIds).toContain(rustRow?.skillId);
    expect(profileRow?.evidenceCount).toBeGreaterThanOrEqual(1);
  });

  it("does not create a detection when nothing matches the taxonomy", async () => {
    const { collectorId, companyId } = await seedCollectorAndCompany("acme-tech-no-match");
    await publishRepository({
      collectorId,
      companyId,
      fullName: "acme/legacy-tool",
      language: "COBOL",
    });

    const result = await runTechnologyPipeline(companyId);
    expect(result.eventsProcessed).toBe(1);
    expect(result.detectionsProduced).toBe(0);
    expect(result.profileUpdated).toBe(false);
  });

  it("harmlessly processes a JobPosted Event alongside RepositoryDiscovered ones", async () => {
    const { collectorId, companyId } = await seedCollectorAndCompany("acme-tech-mixed");
    await publishJobPosted({ collectorId, companyId, title: "Rust Engineer" });
    await publishRepository({
      collectorId,
      companyId,
      fullName: "acme/mixed",
      language: "Rust",
    });

    const result = await runTechnologyPipeline(companyId);
    expect(result.eventsProcessed).toBe(2);
    // Only the RepositoryDiscovered Event produces a detection; JobPosted
    // is evaluated (and its ledger row recorded) but ignored.
    expect(result.detectionsProduced).toBe(1);
  });

  it("is idempotent: re-running with no new Events changes nothing", async () => {
    const { collectorId, companyId } = await seedCollectorAndCompany("acme-tech-idempotent");
    await publishRepository({
      collectorId,
      companyId,
      fullName: "acme/idempotent",
      language: "Rust",
    });

    const first = await runTechnologyPipeline(companyId);
    const second = await runTechnologyPipeline(companyId);

    expect(first.eventsProcessed).toBe(1);
    expect(second.eventsProcessed).toBe(0);
    expect(second.detectionsProduced).toBe(0);
  });

  it("rebuildCompanyTechnologyProfile reproduces the live-updated projection exactly", async () => {
    const { collectorId, companyId } = await seedCollectorAndCompany("acme-tech-rebuild");
    await publishRepository({
      collectorId,
      companyId,
      fullName: "acme/rebuild-a",
      language: "Rust",
      topics: ["zero-knowledge"],
    });
    await publishRepository({
      collectorId,
      companyId,
      fullName: "acme/rebuild-b",
      language: "TypeScript",
      occurredAt: new Date("2026-01-02T00:00:00Z"),
    });

    await runTechnologyPipeline(companyId);

    const [live] = await getDb()
      .select()
      .from(schema.companyTechnologyProfile)
      .where(eq(schema.companyTechnologyProfile.companyId, companyId));
    expect(live).toBeDefined();

    const rebuilt = await rebuildCompanyTechnologyProfile(companyId, live!.asOf);

    expect([...rebuilt.skillIds].sort()).toEqual([...live!.skillIds].sort());
    expect(rebuilt.evidenceCount).toBe(live!.evidenceCount);
  });
});
