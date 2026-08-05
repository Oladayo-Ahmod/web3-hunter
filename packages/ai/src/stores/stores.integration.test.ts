import { getDb, schema } from "@web3-hunter/db";
import { createTestDatabase, type TestDatabase } from "@web3-hunter/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetAIProviderCache } from "../provider-factory";
import { getOrGenerateCompanySummary } from "./company-summary-store";
import { getOrGenerateOpportunitySummary } from "./opportunity-summary-store";
import { getOrGenerateOutreachDraft } from "./outreach-draft-store";
import { getOrGenerateProfileInsight } from "./profile-insight-store";
import { getOrGenerateRecommendationExplanation } from "./recommendation-explanation-store";

const DAY_MS = 24 * 60 * 60 * 1000;
const ASOF = new Date("2026-03-01T00:00:00Z");

async function seedUser(label: string) {
  const db = getDb();
  const id = crypto.randomUUID();
  await db.insert(schema.user).values({ id, name: label, email: `${label}@example.test` });
  await db.insert(schema.userProfile).values({ userId: id, dealBreakerSkillIds: [] });
  return id;
}

async function seedFullScenario(slug: string, userId: string) {
  const db = getDb();

  const [company] = await db.insert(schema.company).values({ slug, name: slug }).returning();

  const [skill] = await db
    .insert(schema.skill)
    .values({ slug: `${slug}-solidity`, name: "Solidity" })
    .returning();
  await db.insert(schema.userSkill).values({ userId, skillId: skill!.id });

  const [opportunity] = await db
    .insert(schema.opportunity)
    .values({
      id: crypto.randomUUID(),
      companyId: company!.id,
      opportunityType: "engineering-hiring-surge",
      detectionWindow: "2026-W01",
      status: "scored",
      score: 0.9,
      reasoning: "Score 0.90 based on 2 Signals.",
      detectedAt: new Date(ASOF.getTime() - 10 * DAY_MS),
      scoredAt: ASOF,
    })
    .returning();

  await db.insert(schema.event).values({
    type: "OpportunityScored",
    category: "intelligence",
    version: 1,
    sourceLabel: "test-fixture",
    occurredAt: ASOF,
    confidence: 0.9,
    metadata: { opportunityId: opportunity!.id, score: 0.9, reasoning: "test" },
    relatedEntityType: "company",
    relatedEntityId: company!.id,
  });

  const [intelligenceUpdatedEvent] = await db
    .insert(schema.event)
    .values({
      type: "IntelligenceUpdated",
      category: "intelligence",
      version: 1,
      sourceLabel: "test-fixture",
      occurredAt: ASOF,
      confidence: 0.9,
      metadata: { companyId: company!.id, confidence: 0.9, trend: "increasing" },
      relatedEntityType: "company",
      relatedEntityId: company!.id,
    })
    .returning();

  await db.insert(schema.companyIntelligence).values({
    companyId: company!.id,
    trend: "increasing",
    confidence: 0.9,
    signalCount: 2,
    lastSignalAt: ASOF,
    asOf: ASOF,
  });

  await db.insert(schema.signal).values({
    id: crypto.randomUUID(),
    companyId: company!.id,
    signalType: "new-backend-role",
    weight: 0.7,
    reasoning: "Posted a Senior Solidity Engineer role.",
    sourceEventIds: [intelligenceUpdatedEvent!.id],
    detectedAt: ASOF,
  });

  const [match] = await db
    .insert(schema.match)
    .values({
      id: crypto.randomUUID(),
      userId,
      opportunityId: opportunity!.id,
      score: 0.85,
      reasoning: "Matches 1 of 1 tagged Skill(s) for this Opportunity.",
      matchedSkillIds: [skill!.id],
      computedAt: ASOF,
    })
    .returning();

  await db.insert(schema.event).values({
    type: "MatchComputed",
    category: "user",
    version: 1,
    sourceLabel: "test-fixture",
    occurredAt: ASOF,
    confidence: 0.85,
    metadata: {
      opportunityId: opportunity!.id,
      score: 0.85,
      reasoning: "test",
      matchedSkillIds: [skill!.id],
    },
    relatedEntityType: "user",
    relatedEntityId: userId,
  });

  const [recommendation] = await db
    .insert(schema.recommendation)
    .values({
      id: crypto.randomUUID(),
      userId,
      matchId: match!.id,
      opportunityId: opportunity!.id,
      status: "active",
      priority: 0.8,
      reasonCode: "eligibility-rules-passed",
      reasonDetails: { matchScore: 0.85, intelligenceConfidence: 0.9 },
      reasonVersion: 1,
      createdAt: ASOF,
      statusChangedAt: ASOF,
    })
    .returning();

  await db.insert(schema.event).values({
    type: "RecommendationCreated",
    category: "decision",
    version: 1,
    sourceLabel: "test-fixture",
    occurredAt: ASOF,
    confidence: 0.85,
    metadata: {
      recommendationId: recommendation!.id,
      matchId: match!.id,
      opportunityId: opportunity!.id,
      priority: 0.8,
      reasonCode: "eligibility-rules-passed",
      reasonDetails: {},
      reasonVersion: 1,
    },
    relatedEntityType: "user",
    relatedEntityId: userId,
  });

  return { company: company!, opportunity: opportunity!, recommendation: recommendation! };
}

describe("AI artifact stores (integration)", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    process.env.DATABASE_URL = testDb.connectionString;
  }, 60_000);

  afterAll(async () => {
    await testDb.stop();
  });

  beforeEach(() => {
    process.env.AI_PROVIDER = "mock";
    resetAIProviderCache();
  });

  afterEach(() => {
    delete process.env.AI_PROVIDER;
    resetAIProviderCache();
  });

  describe("getOrGenerateRecommendationExplanation", () => {
    it("generates, persists, and publishes an explanation with real provenance", async () => {
      const userId = await seedUser("rec-explain-user");
      const { recommendation } = await seedFullScenario("rec-explain-co", userId);

      const outcome = await getOrGenerateRecommendationExplanation(recommendation.id);

      expect(outcome.available).toBe(true);
      if (!outcome.available) return;
      expect(outcome.cached).toBe(false);
      expect(outcome.artifact.version).toBe(1);
      expect(outcome.artifact.content.length).toBeGreaterThan(0);

      const [row] = await getDb()
        .select()
        .from(schema.recommendationExplanation)
        .where(eq(schema.recommendationExplanation.recommendationId, recommendation.id));
      expect(row).toBeDefined();

      const [event] = await getDb().select().from(schema.event).where(eq(schema.event.id, row!.id));
      expect(event?.category).toBe("recommendation");
      expect(event?.type).toBe("AIRecommendationGenerated");

      const provenanceRows = await getDb()
        .select()
        .from(schema.eventProvenance)
        .where(eq(schema.eventProvenance.eventId, row!.id));
      expect(provenanceRows.length).toBeGreaterThan(0);
    });

    it("is cached: a second call with the same prompt version returns the same version without regenerating", async () => {
      const userId = await seedUser("rec-explain-cache-user");
      const { recommendation } = await seedFullScenario("rec-explain-cache-co", userId);

      const first = await getOrGenerateRecommendationExplanation(recommendation.id);
      const second = await getOrGenerateRecommendationExplanation(recommendation.id);

      expect(first.available && second.available).toBe(true);
      if (!first.available || !second.available) return;
      expect(second.cached).toBe(true);
      expect(second.artifact.version).toBe(first.artifact.version);
      expect(second.artifact.content).toBe(first.artifact.content);

      // The cached-path artifact must expose exactly the AIArtifactResult
      // contract — never the raw row's own `id`/foreign-key columns. This
      // guards a real bug found during Milestone 7's live verification.
      expect(Object.keys(second.artifact).sort()).toEqual(
        ["content", "generatedAt", "model", "promptVersion", "provider", "version"].sort(),
      );
    });

    it("returns unavailable when no AI provider is configured", async () => {
      delete process.env.AI_PROVIDER;
      resetAIProviderCache();

      const userId = await seedUser("rec-explain-disabled-user");
      const { recommendation } = await seedFullScenario("rec-explain-disabled-co", userId);

      const outcome = await getOrGenerateRecommendationExplanation(recommendation.id);
      expect(outcome).toEqual({ available: false });
    });
  });

  describe("getOrGenerateOpportunitySummary", () => {
    it("generates and persists a summary referencing the Opportunity", async () => {
      const userId = await seedUser("opp-summary-user");
      const { opportunity } = await seedFullScenario("opp-summary-co", userId);

      const outcome = await getOrGenerateOpportunitySummary(opportunity.id);
      expect(outcome.available).toBe(true);

      const [row] = await getDb()
        .select()
        .from(schema.opportunitySummary)
        .where(eq(schema.opportunitySummary.opportunityId, opportunity.id));
      expect(row).toBeDefined();
      expect(row?.version).toBe(1);
    });
  });

  describe("getOrGenerateCompanySummary", () => {
    it("generates and persists a summary referencing the Company", async () => {
      const userId = await seedUser("company-summary-user");
      const { company } = await seedFullScenario("company-summary-co", userId);

      const outcome = await getOrGenerateCompanySummary(company.id);
      expect(outcome.available).toBe(true);

      const [row] = await getDb()
        .select()
        .from(schema.companySummary)
        .where(eq(schema.companySummary.companyId, company.id));
      expect(row).toBeDefined();
    });
  });

  describe("getOrGenerateOutreachDraft", () => {
    it("generates and persists a draft referencing the Recommendation", async () => {
      const userId = await seedUser("outreach-user");
      const { recommendation } = await seedFullScenario("outreach-co", userId);

      const outcome = await getOrGenerateOutreachDraft(recommendation.id);
      expect(outcome.available).toBe(true);

      const [row] = await getDb()
        .select()
        .from(schema.outreachDraft)
        .where(eq(schema.outreachDraft.recommendationId, recommendation.id));
      expect(row).toBeDefined();
    });
  });

  describe("getOrGenerateProfileInsight", () => {
    it("generates and persists an insight once the User has at least one Match", async () => {
      const userId = await seedUser("profile-insight-user");
      await seedFullScenario("profile-insight-co", userId);

      const outcome = await getOrGenerateProfileInsight(userId);
      expect(outcome.available).toBe(true);

      const [row] = await getDb()
        .select()
        .from(schema.profileInsight)
        .where(eq(schema.profileInsight.userId, userId));
      expect(row).toBeDefined();
    });

    it("is unavailable for a User with a Profile but no Matches yet", async () => {
      const userId = await seedUser("profile-insight-no-match-user");
      const outcome = await getOrGenerateProfileInsight(userId);
      expect(outcome).toEqual({ available: false });
    });
  });

  it("regeneration on a prompt-version bump creates a new version, appending rather than overwriting", async () => {
    const userId = await seedUser("regen-user");
    const { recommendation } = await seedFullScenario("regen-co", userId);

    const db = getDb();
    // Simulate a cached artifact from a *different* prompt template
    // revision than the code's current RECOMMENDATION_EXPLANATION_
    // PROMPT_VERSION (1) — the cache check requires an exact match, so
    // any mismatch (here: 2) must be treated as stale and regenerated
    // rather than trusted, the same as a real prompt-version bump would.
    const staleId = crypto.randomUUID();
    await db.insert(schema.recommendationExplanation).values({
      id: staleId,
      recommendationId: recommendation.id,
      content: "Stale content from a different prompt template.",
      version: 1,
      promptVersion: 2,
      provider: "mock",
      model: "mock-v0",
      generatedAt: ASOF,
    });

    const outcome = await getOrGenerateRecommendationExplanation(recommendation.id);

    expect(outcome.available).toBe(true);
    if (!outcome.available) return;
    expect(outcome.cached).toBe(false);
    expect(outcome.artifact.version).toBe(2);

    const rows = await db
      .select()
      .from(schema.recommendationExplanation)
      .where(eq(schema.recommendationExplanation.recommendationId, recommendation.id));
    expect(rows).toHaveLength(2);
    expect(
      rows.some(
        (row) =>
          row.id === staleId && row.content === "Stale content from a different prompt template.",
      ),
    ).toBe(true);
  });
});
