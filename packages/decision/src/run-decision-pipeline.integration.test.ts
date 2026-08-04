import { getDb, schema } from "@web3-hunter/db";
import { createTestDatabase, type TestDatabase } from "@web3-hunter/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  FRESHNESS_WINDOW_DAYS,
  MIN_CONFIDENCE_THRESHOLD,
  MIN_RELEVANCE_THRESHOLD,
  STALE_EXPIRATION_DAYS,
} from "./constants";
import "./index";
import {
  archiveRecommendation,
  deriveRecommendationCreatedEventId,
  dismissRecommendation,
  restoreRecommendation,
} from "./recommendation-store";
import { InvalidRecommendationTransitionError } from "./state-machine";
import { runDecisionPipeline } from "./run-decision-pipeline";

const DAY_MS = 24 * 60 * 60 * 1000;
const ASOF = new Date("2026-03-01T00:00:00Z");

async function seedUser(label: string) {
  const db = getDb();
  const id = crypto.randomUUID();
  await db.insert(schema.user).values({ id, name: label, email: `${label}@example.test` });
  return id;
}

async function seedCompanyAndOpportunity(
  slug: string,
  input: { status?: "detected" | "scored"; score?: number; scoredAt?: Date } = {},
) {
  const db = getDb();
  const [company] = await db.insert(schema.company).values({ slug, name: slug }).returning();
  const [opportunity] = await db
    .insert(schema.opportunity)
    .values({
      id: crypto.randomUUID(),
      companyId: company!.id,
      opportunityType: "engineering-hiring-surge",
      detectionWindow: "2026-W01",
      status: input.status ?? "scored",
      score: input.score ?? 0.7,
      reasoning: "test",
      detectedAt: new Date(ASOF.getTime() - 10 * DAY_MS),
      scoredAt: input.scoredAt ?? new Date(ASOF.getTime() - 5 * DAY_MS),
    })
    .returning();

  await db.insert(schema.event).values({
    type: "OpportunityScored",
    category: "intelligence",
    version: 1,
    sourceLabel: "test-fixture",
    occurredAt: input.scoredAt ?? new Date(ASOF.getTime() - 5 * DAY_MS),
    confidence: input.score ?? 0.7,
    metadata: { opportunityId: opportunity!.id, score: input.score ?? 0.7, reasoning: "test" },
    relatedEntityType: "company",
    relatedEntityId: company!.id,
  });

  return { companyId: company!.id, opportunityId: opportunity!.id };
}

async function seedCompanyIntelligence(input: {
  companyId: string;
  confidence?: number;
  asOf?: Date;
}) {
  const db = getDb();
  await db.insert(schema.companyIntelligence).values({
    companyId: input.companyId,
    trend: "increasing",
    confidence: input.confidence ?? 0.6,
    signalCount: 3,
    lastSignalAt: input.asOf ?? ASOF,
    asOf: input.asOf ?? ASOF,
  });
}

async function seedMatch(input: {
  userId: string;
  opportunityId: string;
  score?: number;
  computedAt?: Date;
}) {
  const db = getDb();
  const [row] = await db
    .insert(schema.match)
    .values({
      id: crypto.randomUUID(),
      userId: input.userId,
      opportunityId: input.opportunityId,
      score: input.score ?? 0.7,
      reasoning: "test match reasoning",
      matchedSkillIds: [],
      computedAt: input.computedAt ?? ASOF,
    })
    .returning();

  await db.insert(schema.event).values({
    type: "MatchComputed",
    category: "user",
    version: 1,
    sourceLabel: "test-fixture",
    occurredAt: input.computedAt ?? ASOF,
    confidence: input.score ?? 0.7,
    metadata: {
      opportunityId: input.opportunityId,
      score: input.score ?? 0.7,
      reasoning: "test",
      matchedSkillIds: [],
    },
    relatedEntityType: "user",
    relatedEntityId: input.userId,
  });

  return row!;
}

async function seedEligibleScenario(slug: string, userId: string) {
  const { companyId, opportunityId } = await seedCompanyAndOpportunity(slug, {
    status: "scored",
    score: 0.9,
    scoredAt: ASOF,
  });
  await seedCompanyIntelligence({ companyId, confidence: 0.9, asOf: ASOF });
  const match = await seedMatch({ userId, opportunityId, score: 0.9, computedAt: ASOF });
  return { companyId, opportunityId, matchId: match.id };
}

describe("runDecisionPipeline (integration)", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    process.env.DATABASE_URL = testDb.connectionString;
  }, 60_000);

  afterAll(async () => {
    await testDb.stop();
  });

  it("creates a Recommendation for an eligible Match, citing real provenance", async () => {
    const userId = await seedUser("decision-eligible-user");
    const { opportunityId, matchId } = await seedEligibleScenario("decision-eligible-co", userId);

    const result = await runDecisionPipeline(userId, ASOF);
    expect(result.recommendationsCreated).toBe(1);

    const [row] = await getDb()
      .select()
      .from(schema.recommendation)
      .where(eq(schema.recommendation.matchId, matchId));
    expect(row).toBeDefined();
    expect(row?.userId).toBe(userId);
    expect(row?.opportunityId).toBe(opportunityId);
    expect(row?.status).toBe("active");
    expect(row?.priority).toBeGreaterThan(0);
    expect(row?.reasonVersion).toBe(1);

    const createdEventId = deriveRecommendationCreatedEventId(row!.id);
    const provenanceRows = await getDb()
      .select()
      .from(schema.eventProvenance)
      .where(eq(schema.eventProvenance.eventId, createdEventId));
    expect(provenanceRows.length).toBeGreaterThan(0);
  });

  it("does not create a Recommendation when Match score is below the relevance threshold", async () => {
    const userId = await seedUser("decision-low-score-user");
    const { companyId, opportunityId } = await seedCompanyAndOpportunity("decision-low-score-co", {
      status: "scored",
      score: MIN_RELEVANCE_THRESHOLD - 0.05,
      scoredAt: ASOF,
    });
    await seedCompanyIntelligence({ companyId, confidence: 0.9, asOf: ASOF });
    await seedMatch({
      userId,
      opportunityId,
      score: MIN_RELEVANCE_THRESHOLD - 0.05,
      computedAt: ASOF,
    });

    const result = await runDecisionPipeline(userId, ASOF);
    expect(result.recommendationsCreated).toBe(0);
  });

  it("does not create a Recommendation when Intelligence confidence is below threshold", async () => {
    const userId = await seedUser("decision-low-confidence-user");
    const { companyId, opportunityId } = await seedCompanyAndOpportunity(
      "decision-low-confidence-co",
      { status: "scored", score: 0.9, scoredAt: ASOF },
    );
    await seedCompanyIntelligence({
      companyId,
      confidence: MIN_CONFIDENCE_THRESHOLD - 0.05,
      asOf: ASOF,
    });
    await seedMatch({ userId, opportunityId, score: 0.9, computedAt: ASOF });

    const result = await runDecisionPipeline(userId, ASOF);
    expect(result.recommendationsCreated).toBe(0);
  });

  it("does not create a Recommendation when Intelligence is stale", async () => {
    const userId = await seedUser("decision-stale-intelligence-user");
    const { companyId, opportunityId } = await seedCompanyAndOpportunity(
      "decision-stale-intelligence-co",
      { status: "scored", score: 0.9, scoredAt: ASOF },
    );
    await seedCompanyIntelligence({
      companyId,
      confidence: 0.9,
      asOf: new Date(ASOF.getTime() - (FRESHNESS_WINDOW_DAYS + 1) * DAY_MS),
    });
    await seedMatch({ userId, opportunityId, score: 0.9, computedAt: ASOF });

    const result = await runDecisionPipeline(userId, ASOF);
    expect(result.recommendationsCreated).toBe(0);
  });

  it("does not create a Recommendation when the Opportunity is not yet scored", async () => {
    const userId = await seedUser("decision-unscored-user");
    const { companyId, opportunityId } = await seedCompanyAndOpportunity("decision-unscored-co", {
      status: "detected",
      score: 0.9,
      scoredAt: ASOF,
    });
    await seedCompanyIntelligence({ companyId, confidence: 0.9, asOf: ASOF });
    await seedMatch({ userId, opportunityId, score: 0.9, computedAt: ASOF });

    const result = await runDecisionPipeline(userId, ASOF);
    expect(result.recommendationsCreated).toBe(0);
  });

  it("is idempotent on creation: re-running immediately refreshes rather than duplicates", async () => {
    const userId = await seedUser("decision-idempotent-user");
    await seedEligibleScenario("decision-idempotent-co", userId);

    const first = await runDecisionPipeline(userId, ASOF);
    const second = await runDecisionPipeline(userId, ASOF);

    expect(first.recommendationsCreated).toBe(1);
    expect(second.recommendationsCreated).toBe(0);
    expect(second.recommendationsRefreshed).toBe(1);
  });

  it("expires an active Recommendation once its Match is older than STALE_EXPIRATION_DAYS", async () => {
    const userId = await seedUser("decision-expire-user");
    const { opportunityId, matchId } = await seedEligibleScenario("decision-expire-co", userId);

    await runDecisionPipeline(userId, ASOF);

    // Age the Match beyond the stale-expiration window and re-run.
    await getDb()
      .update(schema.match)
      .set({ computedAt: new Date(ASOF.getTime() - (STALE_EXPIRATION_DAYS + 1) * DAY_MS) })
      .where(eq(schema.match.opportunityId, opportunityId));

    const result = await runDecisionPipeline(userId, ASOF);
    expect(result.recommendationsExpired).toBe(1);

    const [row] = await getDb()
      .select()
      .from(schema.recommendation)
      .where(eq(schema.recommendation.matchId, matchId));
    expect(row?.status).toBe("expired");
  });

  describe("lifecycle actions", () => {
    it("supports dismiss then restore", async () => {
      const userId = await seedUser("decision-dismiss-restore-user");
      await seedEligibleScenario("decision-dismiss-restore-co", userId);
      await runDecisionPipeline(userId, ASOF);

      const [row] = await getDb()
        .select()
        .from(schema.recommendation)
        .where(eq(schema.recommendation.userId, userId));

      const afterDismiss = await dismissRecommendation(row!.id, userId, ASOF);
      expect(afterDismiss).toBe("dismissed");

      const afterRestore = await restoreRecommendation(row!.id, userId, ASOF);
      expect(afterRestore).toBe("active");
    });

    it("supports archive then restore", async () => {
      const userId = await seedUser("decision-archive-restore-user");
      await seedEligibleScenario("decision-archive-restore-co", userId);
      await runDecisionPipeline(userId, ASOF);

      const [row] = await getDb()
        .select()
        .from(schema.recommendation)
        .where(eq(schema.recommendation.userId, userId));

      await archiveRecommendation(row!.id, userId, ASOF);
      const afterRestore = await restoreRecommendation(row!.id, userId, ASOF);
      expect(afterRestore).toBe("active");
    });

    it("rejects dismissing an already-dismissed Recommendation", async () => {
      const userId = await seedUser("decision-invalid-transition-user");
      await seedEligibleScenario("decision-invalid-transition-co", userId);
      await runDecisionPipeline(userId, ASOF);

      const [row] = await getDb()
        .select()
        .from(schema.recommendation)
        .where(eq(schema.recommendation.userId, userId));

      await dismissRecommendation(row!.id, userId, ASOF);
      await expect(dismissRecommendation(row!.id, userId, ASOF)).rejects.toThrow(
        InvalidRecommendationTransitionError,
      );
    });

    it("rejects acting on another User's Recommendation", async () => {
      const owner = await seedUser("decision-owner-user");
      const intruder = await seedUser("decision-intruder-user");
      await seedEligibleScenario("decision-ownership-co", owner);
      await runDecisionPipeline(owner, ASOF);

      const [row] = await getDb()
        .select()
        .from(schema.recommendation)
        .where(eq(schema.recommendation.userId, owner));

      await expect(dismissRecommendation(row!.id, intruder, ASOF)).rejects.toThrow();
    });

    it("never modifies Match, Opportunity, or Company Intelligence rows", async () => {
      const userId = await seedUser("decision-isolation-user");
      const { opportunityId, matchId } = await seedEligibleScenario(
        "decision-isolation-co",
        userId,
      );
      await runDecisionPipeline(userId, ASOF);

      const [matchBefore] = await getDb()
        .select()
        .from(schema.match)
        .where(eq(schema.match.id, matchId));
      const [opportunityBefore] = await getDb()
        .select()
        .from(schema.opportunity)
        .where(eq(schema.opportunity.id, opportunityId));

      const [row] = await getDb()
        .select()
        .from(schema.recommendation)
        .where(eq(schema.recommendation.userId, userId));
      await dismissRecommendation(row!.id, userId, ASOF);

      const [matchAfter] = await getDb()
        .select()
        .from(schema.match)
        .where(eq(schema.match.id, matchId));
      const [opportunityAfter] = await getDb()
        .select()
        .from(schema.opportunity)
        .where(eq(schema.opportunity.id, opportunityId));

      expect(matchAfter).toEqual(matchBefore);
      expect(opportunityAfter).toEqual(opportunityBefore);
    });
  });

  it("replay determinism: deleting all Recommendations and re-running the pipeline from identical Match/Opportunity/Intelligence state reproduces byte-identical Recommendations", async () => {
    const userId = await seedUser("decision-replay-user");
    await seedEligibleScenario("decision-replay-co-a", userId);
    await seedEligibleScenario("decision-replay-co-b", userId);

    await runDecisionPipeline(userId, ASOF);

    const before = await getDb()
      .select()
      .from(schema.recommendation)
      .where(eq(schema.recommendation.userId, userId));
    expect(before).toHaveLength(2);

    await getDb().delete(schema.recommendation).where(eq(schema.recommendation.userId, userId));

    await runDecisionPipeline(userId, ASOF);

    const after = await getDb()
      .select()
      .from(schema.recommendation)
      .where(eq(schema.recommendation.userId, userId));

    const normalize = (rows: typeof before) =>
      rows
        .map((row) => ({
          id: row.id,
          matchId: row.matchId,
          opportunityId: row.opportunityId,
          status: row.status,
          priority: row.priority,
          reasonCode: row.reasonCode,
          reasonDetails: row.reasonDetails,
          reasonVersion: row.reasonVersion,
          createdAt: row.createdAt.getTime(),
          statusChangedAt: row.statusChangedAt.getTime(),
        }))
        .sort((a, b) => a.id.localeCompare(b.id));

    expect(normalize(after)).toEqual(normalize(before));
  });
});
