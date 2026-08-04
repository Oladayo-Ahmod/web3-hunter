import { createTestDatabase, type TestDatabase } from "@web3-hunter/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { search } from "./search-service";
import { seedCompany, seedOpportunity } from "./test-support/seed";

describe("search-service (integration)", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    process.env.DATABASE_URL = testDb.connectionString;
  }, 60_000);

  afterAll(async () => {
    await testDb.stop();
  });

  it("matches Companies by name or slug, case-insensitively", async () => {
    const company = await seedCompany({ slug: "acme-labs", name: "Acme Labs" });
    await seedCompany({ slug: "unrelated" });

    const result = await search({ q: "acme", limit: 10 });

    expect(result.companies.map((c) => c.id)).toEqual([company.id]);
  });

  it("matches Opportunities by their Company's name or by opportunityType", async () => {
    const company = await seedCompany({ slug: "beta-labs", name: "Beta Labs" });
    const other = await seedCompany({ slug: "gamma-labs", name: "Gamma Labs" });
    const byCompanyName = await seedOpportunity({
      companyId: company.id,
      opportunityType: "engineering-hiring-surge",
    });
    const byType = await seedOpportunity({
      companyId: other.id,
      opportunityType: "beta-launch",
    });

    const result = await search({ q: "beta", limit: 10 });

    expect(result.opportunities.map((o) => o.id).sort()).toEqual(
      [byCompanyName.id, byType.id].sort(),
    );
  });

  it("treats literal % and _ in the query as literal characters, not wildcards", async () => {
    await seedCompany({ slug: "hundred-percent", name: "100% Labs" });
    await seedCompany({ slug: "unrelated-co", name: "Unrelated Co" });

    const result = await search({ q: "100%", limit: 10 });

    expect(result.companies.map((c) => c.slug)).toEqual(["hundred-percent"]);
  });

  it("respects the limit", async () => {
    for (let i = 0; i < 5; i += 1) {
      await seedCompany({ slug: `limit-co-${i}`, name: `Limit Co ${i}` });
    }

    const result = await search({ q: "limit-co", limit: 2 });

    expect(result.companies).toHaveLength(2);
  });
});
