import { createTestDatabase, type TestDatabase } from "@web3-hunter/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  getOpportunityDetail,
  listOpportunityFeed,
  opportunityFeedQuerySchema,
} from "./opportunity-query-service";
import {
  seedCompany,
  seedCompanyIntelligence,
  seedOpportunity,
  seedSignal,
} from "./test-support/seed";

const DAY_MS = 24 * 60 * 60 * 1000;
const BASE_DATE = new Date("2026-01-01T00:00:00Z");
function daysAfter(days: number): Date {
  return new Date(BASE_DATE.getTime() + days * DAY_MS);
}

/** Applies `opportunityFeedQuerySchema`'s defaults, the same way a real caller (an API route or a Server Component) would before calling `listOpportunityFeed`. */
function feedQuery(partial: Parameters<typeof opportunityFeedQuerySchema.parse>[0] = {}) {
  return opportunityFeedQuerySchema.parse(partial);
}

describe("opportunity-query-service (integration)", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    process.env.DATABASE_URL = testDb.connectionString;
  }, 60_000);

  afterAll(async () => {
    await testDb.stop();
  });

  describe("listOpportunityFeed", () => {
    it("paginates results and reports accurate counts", async () => {
      const company = await seedCompany({ slug: "acme-paginate" });
      for (let i = 0; i < 5; i += 1) {
        await seedOpportunity({
          companyId: company.id,
          detectionWindow: `2026-W0${i + 1}`,
          detectedAt: daysAfter(i * 7),
          score: 0.1 * (i + 1),
          status: "scored",
        });
      }

      const firstPage = await listOpportunityFeed(
        feedQuery({ page: 1, pageSize: 2, sort: "detectedAt", direction: "asc" }),
      );
      expect(firstPage.items).toHaveLength(2);
      expect(firstPage.totalCount).toBe(5);
      expect(firstPage.totalPages).toBe(3);
      expect(firstPage.items[0]?.company.slug).toBe("acme-paginate");

      const lastPage = await listOpportunityFeed(
        feedQuery({ page: 3, pageSize: 2, sort: "detectedAt", direction: "asc" }),
      );
      expect(lastPage.items).toHaveLength(1);
    });

    it("sorts by score descending by default, with unscored Opportunities last", async () => {
      const opportunityType = "test-only-sort-order";
      const company = await seedCompany({ slug: "acme-sort" });
      const low = await seedOpportunity({
        companyId: company.id,
        opportunityType,
        detectionWindow: "2026-W10",
        score: 0.3,
        status: "scored",
      });
      const high = await seedOpportunity({
        companyId: company.id,
        opportunityType,
        detectionWindow: "2026-W11",
        score: 0.9,
        status: "scored",
      });
      const unscored = await seedOpportunity({
        companyId: company.id,
        opportunityType,
        detectionWindow: "2026-W12",
        score: null,
        status: "detected",
      });

      // Scoped to this test's own Opportunity type: the test database is
      // shared across every test in this file, so an unscoped query would
      // also see Opportunities other tests seeded.
      const result = await listOpportunityFeed(
        feedQuery({ page: 1, pageSize: 10, opportunityType }),
      );
      const ids = result.items.map((item) => item.id);
      expect(ids).toEqual([high.id, low.id, unscored.id]);
    });

    it("filters by opportunityType, status, minScore, and detection date range", async () => {
      const company = await seedCompany({ slug: "acme-filter" });
      const matching = await seedOpportunity({
        companyId: company.id,
        opportunityType: "engineering-hiring-surge",
        status: "scored",
        score: 0.8,
        detectedAt: daysAfter(5),
        detectionWindow: "2026-W02",
      });
      await seedOpportunity({
        companyId: company.id,
        opportunityType: "other-type",
        status: "scored",
        score: 0.9,
        detectedAt: daysAfter(5),
        detectionWindow: "2026-W03",
      });
      await seedOpportunity({
        companyId: company.id,
        opportunityType: "engineering-hiring-surge",
        status: "detected",
        score: null,
        detectedAt: daysAfter(5),
        detectionWindow: "2026-W04",
      });
      await seedOpportunity({
        companyId: company.id,
        opportunityType: "engineering-hiring-surge",
        status: "scored",
        score: 0.2,
        detectedAt: daysAfter(5),
        detectionWindow: "2026-W05",
      });
      await seedOpportunity({
        companyId: company.id,
        opportunityType: "engineering-hiring-surge",
        status: "scored",
        score: 0.8,
        detectedAt: daysAfter(60),
        detectionWindow: "2026-W15",
      });

      const result = await listOpportunityFeed(
        feedQuery({
          page: 1,
          pageSize: 10,
          sort: "score",
          direction: "desc",
          opportunityType: "engineering-hiring-surge",
          status: "scored",
          minScore: 0.5,
          detectedAfter: daysAfter(0),
          detectedBefore: daysAfter(10),
        }),
      );

      expect(result.items).toHaveLength(1);
      expect(result.items[0]?.id).toBe(matching.id);
    });
  });

  describe("getOpportunityDetail", () => {
    it("returns null for an unknown Opportunity ID", async () => {
      const detail = await getOpportunityDetail(crypto.randomUUID());
      expect(detail).toBeNull();
    });

    it("includes reasoning, Signals, Company Intelligence, and freshness", async () => {
      const company = await seedCompany({ slug: "acme-detail", name: "Acme Detail" });
      const signalOne = await seedSignal({
        companyId: company.id,
        signalType: "new-backend-role",
        weight: 0.7,
        detectedAt: daysAfter(0),
      });
      const signalTwo = await seedSignal({
        companyId: company.id,
        signalType: "hiring-velocity-increased",
        weight: 0.6,
        detectedAt: daysAfter(3),
      });
      await seedCompanyIntelligence({
        companyId: company.id,
        trend: "increasing",
        confidence: 0.65,
        signalCount: 2,
        lastSignalAt: daysAfter(3),
        asOf: daysAfter(3),
      });
      const opportunity = await seedOpportunity({
        companyId: company.id,
        status: "scored",
        score: 0.72,
        reasoning: "Score 0.72 based on 2 Signals.",
        detectedAt: daysAfter(3),
        scoredAt: daysAfter(3),
      });

      const detail = await getOpportunityDetail(opportunity.id);

      expect(detail).not.toBeNull();
      expect(detail?.reasoning).toBe("Score 0.72 based on 2 Signals.");
      expect(detail?.company).toEqual({ id: company.id, slug: "acme-detail", name: "Acme Detail" });
      expect(detail?.signals.map((s) => s.id).sort()).toEqual([signalOne.id, signalTwo.id].sort());
      expect(detail?.companyIntelligence).toEqual({
        trend: "increasing",
        confidence: 0.65,
        signalCount: 2,
        lastSignalAt: daysAfter(3).toISOString(),
        asOf: daysAfter(3).toISOString(),
      });
      expect(detail?.freshness).toEqual({
        lastSignalAt: daysAfter(3).toISOString(),
        asOf: daysAfter(3).toISOString(),
      });
    });

    it("returns a null Company Intelligence and freshness when none exists yet", async () => {
      const company = await seedCompany({ slug: "acme-no-intelligence" });
      const opportunity = await seedOpportunity({ companyId: company.id });

      const detail = await getOpportunityDetail(opportunity.id);

      expect(detail?.companyIntelligence).toBeNull();
      expect(detail?.freshness).toEqual({ lastSignalAt: null, asOf: null });
    });
  });
});
