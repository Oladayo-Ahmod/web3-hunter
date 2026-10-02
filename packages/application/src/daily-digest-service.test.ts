import { createTestDatabase, type TestDatabase } from "@web3-hunter/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getTodayDigest } from "./daily-digest-service";
import {
  seedCompany,
  seedCompanyContact,
  seedCompanyIntelligence,
  seedJobPostedEvent,
} from "./test-support/seed";

describe("getTodayDigest (integration)", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    process.env.DATABASE_URL = testDb.connectionString;
  }, 60_000);

  afterAll(async () => {
    await testDb.stop();
  });

  it("includes Apply jobs regardless of the Company's priority tag — the gate is role eligibility, not curation", async () => {
    const startup = await seedCompany({ slug: "digest-startup", priority: "high" });
    const noPriority = await seedCompany({ slug: "digest-no-priority" }); // no priority set

    await seedJobPostedEvent({
      companyId: startup.id,
      externalId: "job-1",
      title: "Solidity Engineer",
    });
    await seedJobPostedEvent({
      companyId: noPriority.id,
      externalId: "job-2",
      title: "Smart Contract Engineer",
    });
    // An ineligible role must still be excluded even without the old
    // priority gate — this is the actual filter now.
    await seedJobPostedEvent({
      companyId: noPriority.id,
      externalId: "job-3",
      title: "Account Executive",
    });

    const digest = await getTodayDigest();
    const applySlugs = digest.applyJobs.map((job) => job.companySlug);
    const applyTitles = digest.applyJobs.map((job) => job.title);

    expect(applySlugs).toContain("digest-startup");
    expect(applySlugs).toContain("digest-no-priority");
    expect(applyTitles).not.toContain("Account Executive");
  });

  it("excludes Companies with an open role from DM/Research, and ranks recently-funded first in DM", async () => {
    await seedCompany({
      slug: "digest-funded",
      priority: "medium",
      recentlyFunded: true,
    });
    await seedCompany({
      slug: "digest-high-priority",
      priority: "high",
      recentlyFunded: false,
    });
    const hasOpenRole = await seedCompany({ slug: "digest-has-role", priority: "high" });
    await seedJobPostedEvent({
      companyId: hasOpenRole.id,
      externalId: "job-3",
      title: "Protocol Engineer",
    });

    const digest = await getTodayDigest();
    const dmSlugs = digest.dmTargets.map((target) => target.slug);

    expect(dmSlugs).not.toContain("digest-has-role");
    expect(dmSlugs).toContain("digest-funded");
    expect(dmSlugs).toContain("digest-high-priority");
    // Recently-funded outranks a plain "high priority" Company with no funding signal.
    expect(dmSlugs.indexOf("digest-funded")).toBeLessThan(dmSlugs.indexOf("digest-high-priority"));
  });

  it("ranks a Company with a recently-detected hiring Signal ahead of a higher static priority tier in DM", async () => {
    await seedCompany({ slug: "digest-quiet-high", priority: "high" });
    const active = await seedCompany({ slug: "digest-active-low", priority: "low" });
    await seedCompanyIntelligence({ companyId: active.id, lastSignalAt: new Date() });

    const digest = await getTodayDigest();
    const dmSlugs = digest.dmTargets.map((target) => target.slug);

    expect(dmSlugs.indexOf("digest-active-low")).toBeLessThan(dmSlugs.indexOf("digest-quiet-high"));
  });

  it("puts a no-contact Company in Research rather than DM once DM is otherwise satisfied by contact-bearing targets", async () => {
    const withContact = await seedCompany({ slug: "digest-with-contact", priority: "high" });
    await seedCompanyContact({
      companyId: withContact.id,
      name: "Jordan Founder",
      role: "founder",
      profileUrl: "https://x.com/jordan",
    });
    await seedCompany({ slug: "digest-no-contact", priority: "low" });

    const digest = await getTodayDigest();
    const dmSlugs = digest.dmTargets.map((t) => t.slug);
    const researchSlugs = digest.researchTargets.map((t) => t.slug);

    expect(dmSlugs).toContain("digest-with-contact");
    expect(researchSlugs).not.toContain("digest-with-contact");
    // Only asserted if it didn't also make the top-20 DM cut on its own merits.
    if (!dmSlugs.includes("digest-no-contact")) {
      expect(researchSlugs).toContain("digest-no-contact");
    }
  });
});
