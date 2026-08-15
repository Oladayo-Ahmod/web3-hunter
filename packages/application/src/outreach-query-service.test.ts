import { createTestDatabase, type TestDatabase } from "@web3-hunter/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { classifyOpportunityType, listOutreachTargets } from "./outreach-query-service";
import { seedCompany, seedCompanyContact } from "./test-support/seed";

describe("classifyOpportunityType", () => {
  it("prefers an open role over every other reason to reach out", () => {
    expect(classifyOpportunityType(1, "high", true)).toBe("OPEN_ROLE");
  });

  it("falls back to a verified recent-funding event when there is no open role", () => {
    expect(classifyOpportunityType(0, "high", true)).toBe("RECENTLY_FUNDED");
  });

  it("falls back to the curator's high-priority flag when there is no funding signal", () => {
    expect(classifyOpportunityType(0, "high", false)).toBe("HIGH_PRIORITY_STARTUP");
  });

  it("is still a speculative outreach target otherwise", () => {
    expect(classifyOpportunityType(0, "medium", false)).toBe("SPECULATIVE_OUTREACH");
    expect(classifyOpportunityType(0, null, false)).toBe("SPECULATIVE_OUTREACH");
  });
});

describe("listOutreachTargets (integration)", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    process.env.DATABASE_URL = testDb.connectionString;
  }, 60_000);

  afterAll(async () => {
    await testDb.stop();
  });

  it("only surfaces curated/verified Companies, never rejected or plain-discovered ones", async () => {
    await seedCompany({ slug: "curated-co", discoveryStatus: "curated", priority: "high" });
    await seedCompany({ slug: "verified-co", discoveryStatus: "verified", priority: "medium" });
    await seedCompany({ slug: "rejected-co", discoveryStatus: "rejected", priority: "high" });
    await seedCompany({ slug: "discovered-co", discoveryStatus: "discovered" });

    const targets = await listOutreachTargets();
    const slugs = targets.map((target) => target.slug).sort();

    expect(slugs).toContain("curated-co");
    expect(slugs).toContain("verified-co");
    expect(slugs).not.toContain("rejected-co");
    expect(slugs).not.toContain("discovered-co");
  });

  it("attaches a Company's named Contacts, ordered by seniority", async () => {
    const company = await seedCompany({ slug: "contact-co", priority: "high" });
    await seedCompanyContact({
      companyId: company.id,
      name: "Alex Head Of Eng",
      role: "head_of_engineering",
      profileUrl: "https://x.com/alex",
    });
    await seedCompanyContact({
      companyId: company.id,
      name: "Sam Founder",
      role: "founder",
      profileUrl: "https://x.com/sam",
    });

    const targets = await listOutreachTargets();
    const target = targets.find((entry) => entry.slug === "contact-co");

    expect(target?.contacts.map((c) => c.name)).toEqual(["Sam Founder", "Alex Head Of Eng"]);
    expect(target?.opportunityType).toBe("HIGH_PRIORITY_STARTUP");
  });

  it("has no open jobs and no funding for a plain curated Company with no priority", async () => {
    await seedCompany({ slug: "quiet-co" });

    const targets = await listOutreachTargets();
    const target = targets.find((entry) => entry.slug === "quiet-co");

    expect(target?.opportunityType).toBe("SPECULATIVE_OUTREACH");
    expect(target?.openJobCount).toBe(0);
    expect(target?.contacts).toEqual([]);
  });

  it("classifies a recently-funded Company as RECENTLY_FUNDED and surfaces the funding facts", async () => {
    await seedCompany({
      slug: "funded-co",
      priority: "medium",
      recentlyFunded: true,
      fundingDate: "August 2026",
      fundingAmount: "$8M",
      fundingStage: "Seed",
      fundingSource: "https://example.test/announcement",
    });

    const targets = await listOutreachTargets();
    const target = targets.find((entry) => entry.slug === "funded-co");

    expect(target?.opportunityType).toBe("RECENTLY_FUNDED");
    expect(target?.fundingAmount).toBe("$8M");
    expect(target?.fundingDate).toBe("August 2026");
    expect(target?.reasonToContact).toContain("$8M");
  });

  it("does not classify a Company as RECENTLY_FUNDED merely because fundingStage text is set", async () => {
    // Milestone 18: `fundingStage` alone (e.g. an old "Series A" label)
    // is not the timely signal this bucket exists for — only the
    // explicit `recentlyFunded` flag is.
    await seedCompany({ slug: "stage-only-co", fundingStage: "Series A", recentlyFunded: false });

    const targets = await listOutreachTargets();
    const target = targets.find((entry) => entry.slug === "stage-only-co");

    expect(target?.opportunityType).toBe("SPECULATIVE_OUTREACH");
  });

  it("includes a human-readable reasonToContact for every target", async () => {
    await seedCompany({ slug: "reason-co", priority: "high" });

    const targets = await listOutreachTargets();
    const target = targets.find((entry) => entry.slug === "reason-co");

    expect(target?.reasonToContact).toEqual(expect.any(String));
    expect(target?.reasonToContact.length).toBeGreaterThan(0);
  });
});
