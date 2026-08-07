import { getDb, upsertCompanyDirectory, type CompanyDirectoryEntry } from "@web3-hunter/db";
import { createTestDatabase, type TestDatabase } from "@web3-hunter/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getTrackedCompaniesForCollector } from "./tracked-companies-from-directory";

describe("getTrackedCompaniesForCollector (integration)", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    process.env.DATABASE_URL = testDb.connectionString;
  }, 60_000);

  afterAll(async () => {
    await testDb.stop();
  });

  it("resolves only the companies tracked on the requested Collector, from company_source_identity", async () => {
    const entries: CompanyDirectoryEntry[] = [
      {
        companySlug: "multi-source-co",
        companyName: "Multi Source Co",
        sources: [
          { collectorSlug: "greenhouse", sourceIdentifier: "multi-source-co-gh-token" },
          { collectorSlug: "github", sourceIdentifier: "multi-source-co-org" },
        ],
      },
      {
        companySlug: "greenhouse-only-co",
        companyName: "Greenhouse Only Co",
        sources: [{ collectorSlug: "greenhouse", sourceIdentifier: "greenhouse-only-token" }],
      },
      {
        companySlug: "lever-only-co",
        companyName: "Lever Only Co",
        sources: [{ collectorSlug: "lever", sourceIdentifier: "lever-only-site" }],
      },
    ];

    await upsertCompanyDirectory(getDb(), entries);

    const greenhouseTracked = await getTrackedCompaniesForCollector("greenhouse");
    const greenhouseSlugs = greenhouseTracked.map((c) => c.companySlug).sort();
    expect(greenhouseSlugs).toEqual(["greenhouse-only-co", "multi-source-co"]);

    const multiSourceEntry = greenhouseTracked.find((c) => c.companySlug === "multi-source-co");
    expect(multiSourceEntry?.sourceIdentifier).toBe("multi-source-co-gh-token");
    expect(multiSourceEntry?.companyName).toBe("Multi Source Co");

    const leverTracked = await getTrackedCompaniesForCollector("lever");
    expect(leverTracked.map((c) => c.companySlug)).toEqual(["lever-only-co"]);

    const githubTracked = await getTrackedCompaniesForCollector("github");
    expect(githubTracked.map((c) => c.companySlug)).toEqual(["multi-source-co"]);
  });

  it("returns an empty array for a Collector with no tracked companies", async () => {
    const tracked = await getTrackedCompaniesForCollector("ashby");
    expect(tracked).toEqual([]);
  });
});
