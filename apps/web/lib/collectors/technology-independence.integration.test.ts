import { getDb, schema, seedSkillTaxonomy } from "@web3-hunter/db";
import { createTestDatabase, type TestDatabase } from "@web3-hunter/db/testing";
import { runClassificationPipeline } from "@web3-hunter/classification";
import { TECHNOLOGY_FIT_WEIGHT, runMatchingPipeline, setUserSkills } from "@web3-hunter/matching";
import { runScoringPipeline } from "@web3-hunter/scoring";
import { runTechnologyPipeline } from "@web3-hunter/technology";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { runGithubCollector } from "./run-github";
import { runGreenhouseCollector } from "./run-greenhouse";

/**
 * The required Milestone 9 cross-cutting invariant, verified end-to-end:
 *
 *   Hiring Intelligence influences Opportunity quality.
 *   Technology Intelligence influences User fit.
 *   Those concerns must remain independent.
 *
 * Concretely: feeding a Company GitHub activity alone (no new hiring
 * Events) must update its Technology Profile and a User's Match
 * relevance, while leaving its Opportunity's score/reasoning and its
 * Company Intelligence byte-identical to before. `packages/scoring`
 * genuinely never reads GitHub-sourced Events or `packages/technology`'s
 * projections — this test is what makes that a proven fact, not an
 * assumption.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const REFERENCE = new Date("2026-01-28T00:00:00Z");
const JOB_TITLE = "Backend Platform Engineer";

function daysBefore(days: number): Date {
  return new Date(REFERENCE.getTime() - days * DAY_MS);
}

function greenhouseJobs(prefix: string) {
  return [5, 2].map((offset, index) => ({
    id: 900000 + index,
    title: JOB_TITLE,
    updated_at: daysBefore(offset).toISOString(),
    absolute_url: `https://boards.greenhouse.io/${prefix}/jobs/${index}`,
    location: { name: "Remote" },
  }));
}

function githubRepos(prefix: string) {
  return [
    {
      id: 1,
      name: "protocol-node",
      full_name: `${prefix}/protocol-node`,
      html_url: `https://github.com/${prefix}/protocol-node`,
      description: "The protocol node",
      language: "Rust",
      topics: [],
      archived: false,
      fork: false,
      license: { key: "mit" },
      stargazers_count: 10,
      pushed_at: REFERENCE.toISOString(),
      updated_at: REFERENCE.toISOString(),
    },
  ];
}

function stubFetchForScenario(prefix: string) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL) => {
      const url = String(input);

      if (url.includes("boards-api.greenhouse.io")) {
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          json: async () => ({ jobs: greenhouseJobs(prefix) }),
        } as Response;
      }
      if (url.includes("api.github.com")) {
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          json: async () => githubRepos(prefix),
        } as Response;
      }

      throw new Error(`Unexpected fetch in test: ${url}`);
    }),
  );
}

/** Content-only snapshot of a row this test asserts must stay untouched — strips volatile `updatedAt`. */
function snapshotOpportunity(row: typeof schema.opportunity.$inferSelect) {
  const { updatedAt: _updatedAt, ...rest } = row;
  return { ...rest, detectedAt: rest.detectedAt.getTime(), scoredAt: rest.scoredAt?.getTime() };
}

function snapshotIntelligence(row: typeof schema.companyIntelligence.$inferSelect) {
  const { updatedAt: _updatedAt, ...rest } = row;
  return {
    ...rest,
    lastSignalAt: rest.lastSignalAt?.getTime(),
    asOf: rest.asOf.getTime(),
  };
}

describe("Technology Intelligence independence from Opportunity scoring (integration)", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    process.env.DATABASE_URL = testDb.connectionString;
    await seedSkillTaxonomy(getDb());
  }, 60_000);

  afterAll(async () => {
    await testDb.stop();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it(
    "changing GitHub activity alone updates the Technology Profile and Match relevance, " +
      "leaving Opportunity scoring and Company Intelligence untouched",
    async () => {
      const prefix = "tech-independence-co";
      const db = getDb();

      // 1. Seed hiring activity and let the deterministic pipeline run all
      // the way to a scored, Skill-tagged Opportunity — exactly the state
      // Milestone 3/5 already established, untouched by this milestone.
      stubFetchForScenario(prefix);
      await runGreenhouseCollector([
        { companySlug: prefix, companyName: prefix, boardToken: `${prefix}-gh` },
      ]);
      vi.unstubAllGlobals();

      const [company] = await db
        .select()
        .from(schema.company)
        .where(eq(schema.company.slug, prefix))
        .limit(1);
      if (!company) {
        throw new Error("Company was not resolved by the Greenhouse Collector.");
      }

      await runScoringPipeline(company.id);
      const [opportunityBeforeRow] = await db
        .select()
        .from(schema.opportunity)
        .where(eq(schema.opportunity.companyId, company.id))
        .limit(1);
      if (!opportunityBeforeRow) {
        throw new Error("No Opportunity was detected — fixture didn't cross the threshold.");
      }
      await runClassificationPipeline(opportunityBeforeRow.id);

      const [intelligenceBeforeRow] = await db
        .select()
        .from(schema.companyIntelligence)
        .where(eq(schema.companyIntelligence.companyId, company.id))
        .limit(1);
      expect(intelligenceBeforeRow).toBeDefined();

      // 2. A User who knows Rust but nothing this Opportunity's job
      // postings tagged — zero Skill-fit overlap by construction, so any
      // non-zero Match score that later appears can only come from
      // Technology fit.
      const userId = crypto.randomUUID();
      await db
        .insert(schema.user)
        .values({ id: userId, name: prefix, email: `${prefix}@example.test` });
      const [rustSkill] = await db
        .select()
        .from(schema.skill)
        .where(eq(schema.skill.slug, "rust"))
        .limit(1);
      if (!rustSkill) {
        throw new Error('Skill taxonomy is missing "rust" — fixture assumption broken.');
      }
      await setUserSkills(userId, [rustSkill.id]);

      await runMatchingPipeline(userId, REFERENCE);
      const [matchBefore] = await db
        .select()
        .from(schema.match)
        .where(eq(schema.match.opportunityId, opportunityBeforeRow.id))
        .limit(1);
      expect(matchBefore?.score).toBe(0);
      expect(matchBefore?.matchedTechnologySkillIds).toEqual([]);

      // 3. GitHub activity only — no new hiring Event of any kind.
      stubFetchForScenario(prefix);
      await runGithubCollector([{ companySlug: prefix, companyName: prefix, org: prefix }]);
      vi.unstubAllGlobals();
      await runTechnologyPipeline(company.id);

      // 4. The independence invariant: Opportunity scoring and Company
      // Intelligence must be byte-identical to before — packages/scoring
      // never ran again and never touched GitHub-sourced data.
      const [opportunityAfterRow] = await db
        .select()
        .from(schema.opportunity)
        .where(eq(schema.opportunity.id, opportunityBeforeRow.id))
        .limit(1);
      const [intelligenceAfterRow] = await db
        .select()
        .from(schema.companyIntelligence)
        .where(eq(schema.companyIntelligence.companyId, company.id))
        .limit(1);

      expect(snapshotOpportunity(opportunityAfterRow!)).toEqual(
        snapshotOpportunity(opportunityBeforeRow),
      );
      expect(snapshotIntelligence(intelligenceAfterRow!)).toEqual(
        snapshotIntelligence(intelligenceBeforeRow!),
      );

      // 5. The Technology Profile now exists and evidences Rust.
      const [technologyProfile] = await db
        .select()
        .from(schema.companyTechnologyProfile)
        .where(eq(schema.companyTechnologyProfile.companyId, company.id))
        .limit(1);
      expect(technologyProfile?.skillIds).toContain(rustSkill.id);

      // 6. Re-evaluating this User's Match — with no new hiring Event and
      // no change to the Opportunity's own tagged Skills — now reflects
      // the GitHub-evidenced Technology fit alone.
      await runMatchingPipeline(userId, REFERENCE);
      const [matchAfter] = await db
        .select()
        .from(schema.match)
        .where(eq(schema.match.opportunityId, opportunityBeforeRow.id))
        .limit(1);

      expect(matchAfter?.score).toBe(TECHNOLOGY_FIT_WEIGHT);
      expect(matchAfter?.matchedSkillIds).toEqual([]);
      expect(matchAfter?.matchedTechnologySkillIds).toEqual([rustSkill.id]);
      expect(matchAfter?.reasoning).toContain("GitHub");
    },
    60_000,
  );
});
