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

  it("persists websiteUrl on a newly-created Company when a candidateDomain is supplied, so a later cross-source candidate can resolve to it by domain", async () => {
    // Milestone 15 — the real "Paxos" vs. "paxoslabs" gap: Electric
    // Capital's "paxoslabs" candidate created a Company with no domain
    // (the only signal available at the time), so a later DeFiLlama
    // "Paxos" candidate — a completely different-looking name — had no
    // way to resolve to it and created a duplicate instead. Persisting
    // websiteUrl at creation time is what closes this for future
    // candidates on either side.
    const first = await resolveDiscoveredCompany(
      testDb.db,
      { candidateName: "paxoslabs", candidateDomain: "https://paxos.com" },
      "electric-capital:ats-probe",
    );
    expect(first.kind).toBe("created");

    const [firstRow] = await testDb.db
      .select()
      .from(company)
      .where(eq(company.id, first.companyId))
      .limit(1);
    expect(firstRow?.websiteUrl).toBe("https://paxos.com");

    const second = await resolveDiscoveredCompany(
      testDb.db,
      { candidateName: "Paxos", candidateDomain: "https://paxos.com" },
      "defillama:ats-probe",
    );
    expect(second.kind).toBe("existing");
    expect(second.companyId).toBe(first.companyId);
  });

  it("does not create a false match when domains merely resemble each other — still exact only", async () => {
    await resolveDiscoveredCompany(
      testDb.db,
      { candidateName: "Some Company", candidateDomain: "https://paxos.com" },
      "test-source",
    );

    const result = await resolveDiscoveredCompany(
      testDb.db,
      // A different real subdomain/path, not the same canonical domain.
      { candidateName: "Unrelated Company", candidateDomain: "https://app.paxos.com.evil.com" },
      "test-source",
    );
    expect(result.kind).toBe("created");
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
