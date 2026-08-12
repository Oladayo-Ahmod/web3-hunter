import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { company } from "../schema";
import { createTestDatabase, type TestDatabase } from "../testing/test-database";
import { resolveDiscoveredCompany } from "./company-resolution";

describe("resolveDiscoveredCompany", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    testDb = await createTestDatabase();
  }, 60_000);

  afterAll(async () => {
    await testDb.stop();
  });

  it("creates a new discovered Company when no existing Company matches by domain or name", async () => {
    const result = await resolveDiscoveredCompany(
      testDb.db,
      { candidateName: "Brand New Protocol" },
      "test-source",
    );
    expect(result.kind).toBe("created");

    const [row] = await testDb.db
      .select()
      .from(company)
      .where(eq(company.id, result.companyId))
      .limit(1);
    expect(row?.discoveryStatus).toBe("discovered");
    expect(row?.discoverySource).toBe("test-source");
    expect(row?.discoveredAt).not.toBeNull();
  });

  it("resolves to an existing Company via exact normalized name match, not a new row", async () => {
    const [existing] = await testDb.db
      .insert(company)
      .values({ slug: "existing-name-co", name: "Existing Name Co, Inc." })
      .returning();

    const result = await resolveDiscoveredCompany(
      testDb.db,
      { candidateName: "existing name co" },
      "test-source",
    );
    expect(result.kind).toBe("existing");
    expect(result.companyId).toBe(existing!.id);
  });

  it("resolves to an existing Company via exact canonical domain match", async () => {
    const [existing] = await testDb.db
      .insert(company)
      .values({
        slug: "domain-match-co",
        name: "Totally Different Display Name",
        websiteUrl: "https://www.example-domain.com/",
      })
      .returning();

    const result = await resolveDiscoveredCompany(
      testDb.db,
      { candidateName: "Some Other Candidate Name", candidateDomain: "example-domain.com" },
      "test-source",
    );
    expect(result.kind).toBe("existing");
    expect(result.companyId).toBe(existing!.id);
  });

  it("never merges two companies whose names are merely similar, not identical after normalization", async () => {
    await testDb.db.insert(company).values({ slug: "acme-protocol-co", name: "Acme Protocol" });

    // "Acme Labs" and "Acme Protocol" are different real companies in
    // this test, per Milestone 13's explicit example - normalizing both
    // strips only corporate suffixes and punctuation, never fuzzy-matches
    // across genuinely different words ("protocol" vs "labs").
    const result = await resolveDiscoveredCompany(
      testDb.db,
      { candidateName: "Acme Labs" },
      "test-source",
    );
    expect(result.kind).toBe("created");

    const [acmeLabsRow] = await testDb.db
      .select()
      .from(company)
      .where(eq(company.id, result.companyId))
      .limit(1);
    expect(acmeLabsRow?.slug).not.toBe("acme-protocol-co");
  });

  it("treats a corporate-suffix-only difference as the same company (Inc./Ltd./LLC stripped)", async () => {
    const [existing] = await testDb.db
      .insert(company)
      .values({ slug: "suffix-test-co", name: "Suffix Test Co" })
      .returning();

    const result = await resolveDiscoveredCompany(
      testDb.db,
      { candidateName: "Suffix Test Co, Inc." },
      "test-source",
    );
    expect(result.kind).toBe("existing");
    expect(result.companyId).toBe(existing!.id);
  });
});
