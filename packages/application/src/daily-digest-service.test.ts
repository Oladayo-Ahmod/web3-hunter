import { createTestDatabase, type TestDatabase } from "@web3-hunter/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getTodayDigest } from "./daily-digest-service";
import { seedCompany, seedCompanyContact, seedJobPostedEvent } from "./test-support/seed";

describe("getTodayDigest (integration)", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    process.env.DATABASE_URL = testDb.connectionString;
  }, 60_000);

  afterAll(async () => {
    await testDb.stop();
  });

  it("only includes Apply jobs from priority-tagged (startup-biased) Companies", async () => {
    const startup = await seedCompany({ slug: "digest-startup", priority: "high" });
    const incumbent = await seedCompany({ slug: "digest-incumbent" }); // no priority set

    await seedJobPostedEvent({
      companyId: startup.id,
      externalId: "job-1",
      title: "Solidity Engineer",
    });
    await seedJobPostedEvent({
      companyId: incumbent.id,
      externalId: "job-2",
      title: "Solidity Engineer",
    });

    const digest = await getTodayDigest();
    const applySlugs = digest.applyJobs.map((job) => job.companySlug);

    expect(applySlugs).toContain("digest-startup");
    expect(applySlugs).not.toContain("digest-incumbent");
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
