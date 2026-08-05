import { getDb, schema } from "@web3-hunter/db";
import { createTestDatabase, type TestDatabase } from "@web3-hunter/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  getLatestCompanySummary,
  getLatestOpportunitySummary,
  getLatestOutreachDraft,
  getLatestProfileInsight,
  getLatestRecommendationExplanation,
  getLatestRecommendationExplanationsByIds,
} from "./ai-artifact-lookup";
import {
  seedCompany,
  seedMatch,
  seedOpportunity,
  seedRecommendation,
  seedUser,
} from "./test-support/seed";

async function seedRecommendationScenario(slug: string) {
  const userId = await seedUser(`${slug}-user`);
  const company = await seedCompany({ slug });
  const opportunity = await seedOpportunity({
    companyId: company.id,
    status: "scored",
    score: 0.8,
  });
  const match = await seedMatch({ userId, opportunityId: opportunity.id });
  return seedRecommendation({ userId, matchId: match.id, opportunityId: opportunity.id });
}

async function seedRecommendationExplanation(recommendationId: string, version: number) {
  await getDb()
    .insert(schema.recommendationExplanation)
    .values({
      id: crypto.randomUUID(),
      recommendationId,
      content: `Explanation v${version}`,
      version,
      promptVersion: 1,
      provider: "mock",
      model: "mock-v1",
    });
}

describe("ai-artifact-lookup (integration)", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    process.env.DATABASE_URL = testDb.connectionString;
  }, 60_000);

  afterAll(async () => {
    await testDb.stop();
  });

  it("returns null when no artifact exists for any lookup", async () => {
    const missingId = crypto.randomUUID();
    expect(await getLatestRecommendationExplanation(missingId)).toBeNull();
    expect(await getLatestOutreachDraft(missingId)).toBeNull();
    expect(await getLatestOpportunitySummary(missingId)).toBeNull();
    expect(await getLatestCompanySummary(missingId)).toBeNull();
    expect(await getLatestProfileInsight(missingId)).toBeNull();
  });

  it("returns the highest version when multiple exist", async () => {
    const recommendation = await seedRecommendationScenario("ai-lookup-version-co");
    await seedRecommendationExplanation(recommendation.id, 1);
    await seedRecommendationExplanation(recommendation.id, 2);

    const result = await getLatestRecommendationExplanation(recommendation.id);
    expect(result?.content).toBe("Explanation v2");
    expect(result?.version).toBe(2);
  });

  it("batch lookup returns each Recommendation's latest artifact, keyed by ID", async () => {
    const recommendationA = await seedRecommendationScenario("ai-lookup-batch-a-co");
    const recommendationB = await seedRecommendationScenario("ai-lookup-batch-b-co");
    const recommendationC = await seedRecommendationScenario("ai-lookup-batch-c-co");
    await seedRecommendationExplanation(recommendationA.id, 1);
    await seedRecommendationExplanation(recommendationA.id, 2);
    await seedRecommendationExplanation(recommendationB.id, 1);

    const results = await getLatestRecommendationExplanationsByIds([
      recommendationA.id,
      recommendationB.id,
      recommendationC.id,
    ]);

    expect(results.get(recommendationA.id)?.content).toBe("Explanation v2");
    expect(results.get(recommendationB.id)?.content).toBe("Explanation v1");
    expect(results.size).toBe(2);
  });

  it("batch lookup returns an empty Map for an empty input list", async () => {
    expect((await getLatestRecommendationExplanationsByIds([])).size).toBe(0);
  });

  it("getLatestOpportunitySummary and getLatestCompanySummary read real seeded rows", async () => {
    const company = await seedCompany({ slug: "ai-lookup-co" });
    const opportunity = await seedOpportunity({ companyId: company.id });

    await getDb().insert(schema.opportunitySummary).values({
      id: crypto.randomUUID(),
      opportunityId: opportunity.id,
      content: "Opportunity summary content.",
      version: 1,
      promptVersion: 1,
      provider: "mock",
      model: "mock-v1",
    });
    await getDb().insert(schema.companySummary).values({
      id: crypto.randomUUID(),
      companyId: company.id,
      content: "Company summary content.",
      version: 1,
      promptVersion: 1,
      provider: "mock",
      model: "mock-v1",
    });

    expect((await getLatestOpportunitySummary(opportunity.id))?.content).toBe(
      "Opportunity summary content.",
    );
    expect((await getLatestCompanySummary(company.id))?.content).toBe("Company summary content.");
  });

  it("getLatestProfileInsight reads a real seeded row", async () => {
    const userId = await seedUser("ai-lookup-user");
    await getDb().insert(schema.profileInsight).values({
      id: crypto.randomUUID(),
      userId,
      content: "Profile insight content.",
      version: 1,
      promptVersion: 1,
      provider: "mock",
      model: "mock-v1",
    });

    expect((await getLatestProfileInsight(userId))?.content).toBe("Profile insight content.");
  });
});
