import { createTestDatabase, type TestDatabase } from "@web3-hunter/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getCompanyProfile } from "./company-query-service";
import {
  seedCompany,
  seedCompanyIntelligence,
  seedMatch,
  seedOpportunity,
  seedSignal,
  seedSkill,
  seedUser,
} from "./test-support/seed";

describe("company-query-service (integration)", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    process.env.DATABASE_URL = testDb.connectionString;
  }, 60_000);

  afterAll(async () => {
    await testDb.stop();
  });

  it("returns null for an unknown slug", async () => {
    const profile = await getCompanyProfile("does-not-exist");
    expect(profile).toBeNull();
  });

  it("assembles the Company profile from Company, Intelligence, Opportunities, and Signals", async () => {
    const company = await seedCompany({ slug: "acme-profile", name: "Acme Profile" });
    const otherCompany = await seedCompany({ slug: "other-company" });

    await seedCompanyIntelligence({
      companyId: company.id,
      trend: "increasing",
      confidence: 0.5,
      signalCount: 3,
    });

    const opportunityOne = await seedOpportunity({
      companyId: company.id,
      detectionWindow: "2026-W01",
      status: "scored",
      score: 0.6,
    });
    const opportunityTwo = await seedOpportunity({
      companyId: company.id,
      detectionWindow: "2026-W02",
      status: "detected",
      score: null,
    });
    // Belongs to a different Company — must never leak into this profile.
    await seedOpportunity({ companyId: otherCompany.id, detectionWindow: "2026-W01" });

    const signalOne = await seedSignal({ companyId: company.id });
    const signalTwo = await seedSignal({ companyId: company.id });
    await seedSignal({ companyId: otherCompany.id });

    const profile = await getCompanyProfile("acme-profile");

    expect(profile?.company).toEqual({
      id: company.id,
      slug: "acme-profile",
      name: "Acme Profile",
    });
    expect(profile?.intelligence?.trend).toBe("increasing");
    expect(profile?.activeOpportunities.map((o) => o.id).sort()).toEqual(
      [opportunityOne.id, opportunityTwo.id].sort(),
    );
    expect(profile?.recentSignals.map((s) => s.id).sort()).toEqual(
      [signalOne.id, signalTwo.id].sort(),
    );
  });

  it("returns a null Intelligence summary and empty lists for a Company with no activity yet", async () => {
    await seedCompany({ slug: "acme-quiet" });

    const profile = await getCompanyProfile("acme-quiet");

    expect(profile?.intelligence).toBeNull();
    expect(profile?.activeOpportunities).toEqual([]);
    expect(profile?.recentSignals).toEqual([]);
  });

  it("attaches the viewer's Match to their active Opportunities, when present", async () => {
    const company = await seedCompany({ slug: "acme-viewer-profile" });
    const opportunity = await seedOpportunity({
      companyId: company.id,
      status: "scored",
      score: 0.5,
    });
    const userId = await seedUser("company-profile-viewer");
    const rust = await seedSkill("company-profile-rust", "Rust");
    await seedMatch({
      userId,
      opportunityId: opportunity.id,
      score: 0.7,
      matchedSkillIds: [rust.id],
    });

    const profileWithoutViewer = await getCompanyProfile("acme-viewer-profile");
    expect(profileWithoutViewer?.activeOpportunities[0]?.match).toBeNull();

    const profileWithViewer = await getCompanyProfile("acme-viewer-profile", userId);
    const item = profileWithViewer?.activeOpportunities.find((o) => o.id === opportunity.id);
    expect(item?.match?.score).toBe(0.7);
    expect(item?.match?.matchedSkills).toEqual([{ id: rust.id, slug: rust.slug, name: "Rust" }]);
  });
});
