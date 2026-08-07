import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { company, companySourceIdentity } from "../schema";
import { createTestDatabase, type TestDatabase } from "../testing/test-database";
import { upsertCompanyDirectory, type CompanyDirectoryEntry } from "./company-directory";

describe("upsertCompanyDirectory", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    testDb = await createTestDatabase();
  }, 60_000);

  afterAll(async () => {
    await testDb.stop();
  });

  it("creates a Company and its source identities on first run", async () => {
    const entry: CompanyDirectoryEntry = {
      companySlug: "test-directory-co",
      companyName: "Test Directory Co",
      websiteUrl: "https://example.com",
      careersPageUrl: "https://example.com/careers",
      category: "defi",
      tags: ["ethereum", "solana"],
      sources: [{ collectorSlug: "greenhouse", sourceIdentifier: "test-directory-co-gh" }],
    };

    const [result] = await upsertCompanyDirectory(testDb.db, [entry]);
    expect(result?.companySlug).toBe("test-directory-co");

    const [row] = await testDb.db
      .select()
      .from(company)
      .where(eq(company.slug, "test-directory-co"))
      .limit(1);
    expect(row?.websiteUrl).toBe("https://example.com");
    expect(row?.category).toBe("defi");
    expect(row?.tags).toEqual(["ethereum", "solana"]);

    const identities = await testDb.db
      .select()
      .from(companySourceIdentity)
      .where(eq(companySourceIdentity.sourceIdentifier, "test-directory-co-gh"));
    expect(identities).toHaveLength(1);
    expect(identities[0]?.companyId).toBe(result?.companyId);
  });

  it("enriches an existing Company in place rather than duplicating it", async () => {
    const first: CompanyDirectoryEntry = {
      companySlug: "test-directory-enrich-co",
      companyName: "Enrich Co",
      sources: [],
    };
    const [firstResult] = await upsertCompanyDirectory(testDb.db, [first]);

    const second: CompanyDirectoryEntry = {
      companySlug: "test-directory-enrich-co",
      companyName: "Enrich Co",
      websiteUrl: "https://enrich.example.com",
      description: "Added on the second pass",
      sources: [],
    };
    const [secondResult] = await upsertCompanyDirectory(testDb.db, [second]);

    expect(secondResult?.companyId).toBe(firstResult?.companyId);

    const rows = await testDb.db
      .select()
      .from(company)
      .where(eq(company.slug, "test-directory-enrich-co"));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.websiteUrl).toBe("https://enrich.example.com");
    expect(rows[0]?.description).toBe("Added on the second pass");
  });

  it("is idempotent for company_source_identity: re-running the same entry does not duplicate the mapping", async () => {
    const entry: CompanyDirectoryEntry = {
      companySlug: "test-directory-idempotent-co",
      companyName: "Idempotent Co",
      sources: [{ collectorSlug: "github", sourceIdentifier: "test-directory-idempotent-org" }],
    };

    await upsertCompanyDirectory(testDb.db, [entry]);
    await upsertCompanyDirectory(testDb.db, [entry]);

    const identities = await testDb.db
      .select()
      .from(companySourceIdentity)
      .where(eq(companySourceIdentity.sourceIdentifier, "test-directory-idempotent-org"));
    expect(identities).toHaveLength(1);
  });

  it("throws a clear error for an unknown collector slug rather than silently accepting it", async () => {
    const entry: CompanyDirectoryEntry = {
      companySlug: "test-directory-bad-co",
      companyName: "Bad Co",
      sources: [{ collectorSlug: "not-a-real-ats", sourceIdentifier: "whatever" }],
    };

    await expect(upsertCompanyDirectory(testDb.db, [entry])).rejects.toThrow(
      /unknown collector slug/i,
    );
  });
});
