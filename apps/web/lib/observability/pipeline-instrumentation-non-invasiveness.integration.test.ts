import { getDb, schema, seedSkillTaxonomy } from "@web3-hunter/db";
import { createTestDatabase, type TestDatabase } from "@web3-hunter/db/testing";
import { runClassificationPipeline } from "@web3-hunter/classification";
import { runDecisionPipeline } from "@web3-hunter/decision";
import { runMatchingPipeline, setUserSkills } from "@web3-hunter/matching";
import { runScoringPipeline } from "@web3-hunter/scoring";
import { runTechnologyPipeline } from "@web3-hunter/technology";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { runGreenhouseCollector } from "../collectors/run-greenhouse";
import { recordPipelineRun } from "./record-pipeline-run";

/**
 * Milestone 10's central architectural claim, verified directly: wrapping
 * every deterministic pipeline invocation with `recordPipelineRun` adds an
 * observability side-channel and changes *nothing* about what the
 * pipeline itself computes or persists. This runs the identical scenario
 * twice — once calling `runScoringPipeline`/etc. directly (uninstrumented,
 * the "control"), once through `recordPipelineRun` (instrumented) — for
 * two independent Companies within the same database, and asserts the
 * resulting Signal/Company Intelligence/Opportunity/Match/Recommendation
 * *content* (never IDs — see every prior milestone's replay tests for
 * that established distinction) is byte-identical between them.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const REFERENCE = new Date("2026-01-28T00:00:00Z");
const JOB_TITLE = "Backend Platform Engineer";

function daysBefore(days: number): Date {
  return new Date(REFERENCE.getTime() - days * DAY_MS);
}

// `id` must be numeric (see `greenhouseJobSchema`) and, critically, unique
// *per scenario* — `runIngestionPipeline`'s `findPreviousPayload` looks up
// "the prior Raw Record with this externalId" scoped only by
// `(collectorId, externalId)`, not by Company. Two scenarios sharing one
// Greenhouse Collector row and the same numeric ids would have their jobs
// misdiffed against each other's prior payload, turning a `JobPosted` into
// a spurious `JobUpdated` — which Signal detectors don't fire on. Each
// scenario gets its own `idBase` for exactly the reason
// `multi-source-pipeline.integration.test.ts`'s equivalent fixture embeds
// the scenario prefix into its own (string) external ids.
function greenhouseJobs(prefix: string, idBase: number) {
  return [5, 2].map((offset, index) => ({
    id: idBase + index,
    title: JOB_TITLE,
    updated_at: daysBefore(offset).toISOString(),
    absolute_url: `https://boards.greenhouse.io/${prefix}/jobs/${index}`,
    location: { name: "Remote" },
  }));
}

function stubFetchForScenario(prefix: string, idBase: number) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes("boards-api.greenhouse.io")) {
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          json: async () => ({ jobs: greenhouseJobs(prefix, idBase) }),
        } as Response;
      }
      throw new Error(`Unexpected fetch in test: ${url}`);
    }),
  );
}

/** Content-only snapshot — strips every random/foreign ID, keeping only what a consumer could observe. */
interface Snapshot {
  signals: Array<{ signalType: string; weight: number; reasoning: string; detectedAt: number }>;
  intelligence: { trend: string; confidence: number; signalCount: number } | null;
  opportunities: Array<{
    status: string;
    score: number | null;
    reasoning: string;
    detectionWindow: string;
  }>;
  matches: Array<{ score: number; reasoning: string; matchedSkillIds: string[] }>;
  recommendations: Array<{ status: string; priority: number; reasonCode: string }>;
}

async function runScenario(
  prefix: string,
  instrumented: boolean,
  idBase: number,
): Promise<Snapshot> {
  const db = getDb();

  stubFetchForScenario(prefix, idBase);
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
    throw new Error(`Company "${prefix}" was not resolved by the Greenhouse Collector.`);
  }

  const scope = { scopeType: "company" as const, scopeId: company.id };

  if (instrumented) {
    await recordPipelineRun({ pipelineName: "scoring", ...scope }, () =>
      runScoringPipeline(company.id),
    );
  } else {
    await runScoringPipeline(company.id);
  }

  const opportunityRows = await db
    .select()
    .from(schema.opportunity)
    .where(eq(schema.opportunity.companyId, company.id));

  for (const opportunity of opportunityRows) {
    if (instrumented) {
      await recordPipelineRun(
        { pipelineName: "classification", scopeType: "opportunity", scopeId: opportunity.id },
        () => runClassificationPipeline(opportunity.id),
      );
    } else {
      await runClassificationPipeline(opportunity.id);
    }
  }

  if (instrumented) {
    await recordPipelineRun({ pipelineName: "technology", ...scope }, () =>
      runTechnologyPipeline(company.id),
    );
  } else {
    await runTechnologyPipeline(company.id);
  }

  const skillRows =
    opportunityRows.length > 0
      ? await db
          .select({ skillId: schema.opportunitySkill.skillId })
          .from(schema.opportunitySkill)
          .where(
            inArray(
              schema.opportunitySkill.opportunityId,
              opportunityRows.map((row) => row.id),
            ),
          )
      : [];
  const skillIds = [...new Set(skillRows.map((row) => row.skillId))];

  const userId = crypto.randomUUID();
  await db
    .insert(schema.user)
    .values({ id: userId, name: prefix, email: `${prefix}@example.test` });

  if (skillIds.length > 0) {
    await setUserSkills(userId, skillIds);
    const userScope = { scopeType: "user" as const, scopeId: userId };

    if (instrumented) {
      await recordPipelineRun({ pipelineName: "matching", ...userScope }, () =>
        runMatchingPipeline(userId, REFERENCE),
      );
      await recordPipelineRun({ pipelineName: "decision", ...userScope }, () =>
        runDecisionPipeline(userId, REFERENCE),
      );
    } else {
      await runMatchingPipeline(userId, REFERENCE);
      await runDecisionPipeline(userId, REFERENCE);
    }
  }

  const signalRows = await db
    .select()
    .from(schema.signal)
    .where(eq(schema.signal.companyId, company.id));
  const [intelligenceRow] = await db
    .select()
    .from(schema.companyIntelligence)
    .where(eq(schema.companyIntelligence.companyId, company.id))
    .limit(1);
  // Scoped to *this* scenario's own Opportunities, not merely to `userId`:
  // `runMatchingPipeline` evaluates a User against every `scored`
  // Opportunity in the database, not just the ones this scenario created.
  // Since both scenarios in this file tag their Opportunity with the same
  // Skill, a later scenario's freshly-seeded User would otherwise also
  // (correctly, but irrelevantly here) match the earlier scenario's
  // Opportunity too — the same cross-scenario contamination
  // `technology-independence.integration.test.ts` and
  // `multi-source-pipeline.integration.test.ts` already guard against.
  const opportunityIds = opportunityRows.map((row) => row.id);
  const matchRows =
    opportunityIds.length > 0
      ? await db
          .select()
          .from(schema.match)
          .where(
            and(
              eq(schema.match.userId, userId),
              inArray(schema.match.opportunityId, opportunityIds),
            ),
          )
      : [];
  const recommendationRows =
    opportunityIds.length > 0
      ? await db
          .select()
          .from(schema.recommendation)
          .where(
            and(
              eq(schema.recommendation.userId, userId),
              inArray(schema.recommendation.opportunityId, opportunityIds),
            ),
          )
      : [];

  return {
    signals: signalRows
      .map((row) => ({
        signalType: row.signalType,
        weight: row.weight,
        reasoning: row.reasoning,
        detectedAt: row.detectedAt.getTime(),
      }))
      .sort((a, b) => a.signalType.localeCompare(b.signalType) || a.detectedAt - b.detectedAt),
    intelligence: intelligenceRow
      ? {
          trend: intelligenceRow.trend,
          confidence: intelligenceRow.confidence,
          signalCount: intelligenceRow.signalCount,
        }
      : null,
    opportunities: opportunityRows
      .map((row) => ({
        status: row.status,
        score: row.score,
        reasoning: row.reasoning,
        detectionWindow: row.detectionWindow,
      }))
      .sort((a, b) => a.detectionWindow.localeCompare(b.detectionWindow)),
    matches: matchRows
      .map((row) => ({
        score: row.score,
        reasoning: row.reasoning,
        matchedSkillIds: [...row.matchedSkillIds].sort(),
      }))
      .sort((a, b) => a.score - b.score),
    recommendations: recommendationRows
      .map((row) => ({ status: row.status, priority: row.priority, reasonCode: row.reasonCode }))
      .sort((a, b) => b.priority - a.priority),
  };
}

describe("pipeline instrumentation is non-invasive (integration)", () => {
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
    "produces byte-identical (content, not ID) Signals/Intelligence/Opportunities/Matches/" +
      "Recommendations whether every pipeline stage is wrapped with recordPipelineRun or called directly",
    async () => {
      const control = await runScenario("non-invasive-control", false, 810000);
      const instrumented = await runScenario("non-invasive-wrapped", true, 820000);

      expect(instrumented).toEqual(control);
    },
    60_000,
  );

  it("still persists a pipeline_run row for every instrumented invocation in the wrapped scenario", async () => {
    const rows = await getDb()
      .select()
      .from(schema.pipelineRun)
      .where(eq(schema.pipelineRun.status, "succeeded"));

    // scoring + classification + technology + matching + decision, at
    // least once each, from the "instrumented" scenario above.
    const pipelineNames = new Set(rows.map((row) => row.pipelineName));
    expect(pipelineNames).toEqual(
      new Set(["scoring", "classification", "technology", "matching", "decision"]),
    );
  });
});
