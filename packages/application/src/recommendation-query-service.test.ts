import { createTestDatabase, type TestDatabase } from "@web3-hunter/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getRecommendationDetail, listRecommendations } from "./recommendation-query-service";
import {
  seedCompany,
  seedMatch,
  seedOpportunity,
  seedRecommendation,
  seedSkill,
  seedUser,
} from "./test-support/seed";

async function seedRecommendationScenario(
  slug: string,
  userId: string,
  overrides: { status?: "active" | "dismissed" | "archived" | "expired"; priority?: number } = {},
) {
  const company = await seedCompany({ slug });
  const opportunity = await seedOpportunity({
    companyId: company.id,
    status: "scored",
    score: 0.7,
  });
  const solidity = await seedSkill(`${slug}-solidity`, "Solidity");
  const match = await seedMatch({
    userId,
    opportunityId: opportunity.id,
    score: 0.8,
    matchedSkillIds: [solidity.id],
  });
  const recommendation = await seedRecommendation({
    userId,
    matchId: match.id,
    opportunityId: opportunity.id,
    ...overrides,
  });
  return { company, opportunity, match, recommendation };
}

describe("recommendation-query-service (integration)", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    process.env.DATABASE_URL = testDb.connectionString;
  }, 60_000);

  afterAll(async () => {
    await testDb.stop();
  });

  describe("listRecommendations", () => {
    it("returns a User's Recommendations with rendered reasoning and Match data", async () => {
      const userId = await seedUser("list-recs-user");
      const { recommendation, opportunity } = await seedRecommendationScenario(
        "list-recs-co",
        userId,
      );

      const results = await listRecommendations(userId);

      expect(results).toHaveLength(1);
      expect(results[0]?.id).toBe(recommendation.id);
      expect(results[0]?.status).toBe("active");
      expect(results[0]?.reason).toContain("Recommended");
      expect(results[0]?.opportunity.id).toBe(opportunity.id);
      expect(results[0]?.opportunity.match?.matchedSkills).toHaveLength(1);
    });

    it("never returns another User's Recommendations", async () => {
      const owner = await seedUser("isolation-owner-user");
      const other = await seedUser("isolation-other-user");
      await seedRecommendationScenario("isolation-co", owner);

      expect(await listRecommendations(other)).toEqual([]);
    });

    it("filters by status when provided", async () => {
      const userId = await seedUser("filter-status-user");
      await seedRecommendationScenario("filter-status-active-co", userId, { status: "active" });
      await seedRecommendationScenario("filter-status-dismissed-co", userId, {
        status: "dismissed",
      });

      const active = await listRecommendations(userId, "active");
      const dismissed = await listRecommendations(userId, "dismissed");

      expect(active.every((r) => r.status === "active")).toBe(true);
      expect(dismissed.every((r) => r.status === "dismissed")).toBe(true);
      expect(active.length).toBeGreaterThanOrEqual(1);
      expect(dismissed.length).toBeGreaterThanOrEqual(1);
    });

    it("sorts by priority descending", async () => {
      const userId = await seedUser("sort-priority-user");
      const low = await seedRecommendationScenario("sort-priority-low-co", userId, {
        priority: 0.2,
      });
      const high = await seedRecommendationScenario("sort-priority-high-co", userId, {
        priority: 0.9,
      });

      const results = await listRecommendations(userId);
      const ids = results.map((r) => r.id);
      expect(ids.indexOf(high.recommendation.id)).toBeLessThan(ids.indexOf(low.recommendation.id));
    });
  });

  describe("getRecommendationDetail", () => {
    it("returns full detail including signals/intelligence via the Opportunity Detail read model", async () => {
      const userId = await seedUser("detail-user");
      const { recommendation, opportunity } = await seedRecommendationScenario("detail-co", userId);

      const detail = await getRecommendationDetail(recommendation.id, userId);

      expect(detail?.id).toBe(recommendation.id);
      expect(detail?.opportunity.id).toBe(opportunity.id);
      expect(detail?.opportunity.signals).toBeDefined();
      expect(detail?.opportunity.match).not.toBeNull();
    });

    it("returns null for an unknown Recommendation", async () => {
      const userId = await seedUser("detail-unknown-user");
      expect(await getRecommendationDetail(crypto.randomUUID(), userId)).toBeNull();
    });

    it("returns null for another User's Recommendation, indistinguishable from not found", async () => {
      const owner = await seedUser("detail-owner-user");
      const other = await seedUser("detail-other-user");
      const { recommendation } = await seedRecommendationScenario("detail-ownership-co", owner);

      expect(await getRecommendationDetail(recommendation.id, other)).toBeNull();
    });
  });
});
