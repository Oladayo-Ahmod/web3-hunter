import { getDb, schema, seedSkillTaxonomy } from "@web3-hunter/db";
import { createTestDatabase, type TestDatabase } from "@web3-hunter/db/testing";
import { runClassificationPipeline } from "@web3-hunter/classification";
import { runDecisionPipeline } from "@web3-hunter/decision";
import { runMatchingPipeline, setUserSkills } from "@web3-hunter/matching";
import { runScoringPipeline } from "@web3-hunter/scoring";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { runAshbyCollector } from "./run-ashby";
import { runGreenhouseCollector } from "./run-greenhouse";
import { runLeverCollector } from "./run-lever";

/**
 * End-to-end coverage for Milestone 8's two required cross-cutting
 * guarantees:
 *
 * 1. **Replay determinism**, extended to the full multi-source pipeline
 *    (ingestion -> scoring -> classification -> matching -> decision):
 *    running the identical scenario twice, from two independently empty
 *    Companies within the same database, must reproduce byte-identical
 *    content (never identical randomly-generated IDs — see every prior
 *    milestone's replay tests for that established distinction).
 * 2. **Order independence**: the same underlying hiring activity, spread
 *    across Greenhouse, Lever, and Ashby, must produce identical results
 *    regardless of which order those three Collectors run in.
 *
 * Both scenarios run against one shared database (one embedded Postgres
 * instance, one `getDb()` singleton — `@web3-hunter/db`'s `getDb()` caches
 * its connection for the process, so a second `createTestDatabase()` call
 * in the same file would silently keep talking to the first instance).
 * Each scenario therefore gets its own Company (and its own board
 * tokens/site/board name), which is also what keeps their Raw Records —
 * scoped only by `(collectorId, contentHash)`, since a real Greenhouse
 * account is shared by every company it hosts — from colliding with each
 * other. Company-identifying fields (external IDs, URLs) are deliberately
 * *not* part of the compared content for that reason; every field that
 * genuinely reflects hiring activity (titles, Signal weights/reasoning,
 * Intelligence, Opportunity scores, Match/Recommendation content) is.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const REFERENCE = new Date("2026-01-28T00:00:00Z");
const JOB_TITLE = "Backend Platform Engineer";

function daysBefore(days: number): Date {
  return new Date(REFERENCE.getTime() - days * DAY_MS);
}

// Deliberately interleaved across sources (Greenhouse posts the oldest and
// a middle role, Lever and Ashby the rest) so no single Collector's run
// happens to be a no-op no matter which position it runs in.
const GREENHOUSE_OFFSETS = [5, 2];
const LEVER_OFFSETS = [4, 1];
const ASHBY_OFFSETS = [3, 0];

function greenhouseJobs(prefix: string) {
  return GREENHOUSE_OFFSETS.map((offset, index) => ({
    id: `${prefix}-gh-${index}`,
    title: JOB_TITLE,
    updated_at: daysBefore(offset).toISOString(),
    absolute_url: `https://boards.greenhouse.io/${prefix}/jobs/${index}`,
    location: { name: "Remote" },
  }));
}

function leverPostings(prefix: string) {
  return LEVER_OFFSETS.map((offset, index) => ({
    id: `${prefix}-lever-${index}`,
    text: JOB_TITLE,
    createdAt: daysBefore(offset).getTime(),
    updatedAt: daysBefore(offset).getTime(),
    hostedUrl: `https://jobs.lever.co/${prefix}/${index}`,
    categories: { location: "Remote" },
  }));
}

function ashbyJobs(prefix: string) {
  return ASHBY_OFFSETS.map((offset, index) => ({
    id: `${prefix}-ashby-${index}`,
    title: JOB_TITLE,
    publishedAt: daysBefore(offset).toISOString(),
    updatedAt: daysBefore(offset).toISOString(),
    location: "Remote",
    jobUrl: `https://jobs.ashbyhq.com/${prefix}/${index}`,
  }));
}

/** Routes the stubbed global `fetch` to the right fixture by URL shape, exactly as each real Collector calls it. */
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
      if (url.includes("api.lever.co")) {
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          json: async () => leverPostings(prefix),
        } as Response;
      }
      if (url.includes("api.ashbyhq.com")) {
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          json: async () => ({ jobs: ashbyJobs(prefix) }),
        } as Response;
      }

      throw new Error(`Unexpected fetch in test: ${url}`);
    }),
  );
}

type Source = "greenhouse" | "lever" | "ashby";

async function runCollectorsInOrder(prefix: string, order: readonly Source[]) {
  const runners: Record<Source, () => Promise<unknown>> = {
    greenhouse: () =>
      runGreenhouseCollector([
        { companySlug: prefix, companyName: prefix, boardToken: `${prefix}-gh` },
      ]),
    lever: () =>
      runLeverCollector([{ companySlug: prefix, companyName: prefix, site: `${prefix}-lever` }]),
    ashby: () =>
      runAshbyCollector([
        { companySlug: prefix, companyName: prefix, boardName: `${prefix}-ashby` },
      ]),
  };

  for (const source of order) {
    await runners[source]();
  }
}

interface Snapshot {
  sourceIdentityCount: number;
  eventCountsByType: Record<string, number>;
  intelligence: {
    trend: string;
    confidence: number;
    signalCount: number;
    lastSignalAt: number | null;
    asOf: number;
  } | null;
  signals: Array<{ signalType: string; weight: number; reasoning: string; detectedAt: number }>;
  opportunities: Array<{
    opportunityType: string;
    status: string;
    score: number | null;
    reasoning: string;
    detectionWindow: string;
    detectedAt: number;
    scoredAt: number | null;
  }>;
  matches: Array<{
    score: number;
    reasoning: string;
    matchedSkillIds: string[];
    computedAt: number;
  }>;
  recommendations: Array<{
    status: string;
    priority: number;
    reasonCode: string;
    reasonDetails: unknown;
    reasonVersion: number;
    createdAt: number;
    statusChangedAt: number;
  }>;
}

/**
 * Runs the full pipeline for one Company scenario — three Collectors in a
 * given order, then Scoring, Classification, Matching, and Decision, the
 * same manual chain `apps/web/scripts/run-*.ts` invoke on a schedule — and
 * returns a content-only snapshot: every ID (Company/Event/Signal/
 * Opportunity/Match/Recommendation) is stripped, per this project's
 * established replay-determinism convention (see e.g.
 * `packages/decision/src/run-decision-pipeline.integration.test.ts`) —
 * only Skill IDs survive, because the Skill taxonomy is seeded once and
 * shared by every scenario in this file, so identical Skills really do
 * mean identical IDs.
 */
async function runScenario(prefix: string, order: readonly Source[]): Promise<Snapshot> {
  const db = getDb();

  stubFetchForScenario(prefix);
  await runCollectorsInOrder(prefix, order);
  vi.unstubAllGlobals();

  const [company] = await db
    .select()
    .from(schema.company)
    .where(eq(schema.company.slug, prefix))
    .limit(1);
  if (!company) {
    throw new Error(`Company "${prefix}" was not resolved by any Collector.`);
  }

  const sourceIdentityRows = await db
    .select()
    .from(schema.companySourceIdentity)
    .where(eq(schema.companySourceIdentity.companyId, company.id));

  await runScoringPipeline(company.id);

  const opportunityRows = await db
    .select()
    .from(schema.opportunity)
    .where(eq(schema.opportunity.companyId, company.id));

  for (const opportunity of opportunityRows) {
    await runClassificationPipeline(opportunity.id);
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
    await runMatchingPipeline(userId, REFERENCE);
    await runDecisionPipeline(userId, REFERENCE);
  }

  const eventRows = await db
    .select({ type: schema.event.type })
    .from(schema.event)
    .where(
      and(
        eq(schema.event.relatedEntityType, "company"),
        eq(schema.event.relatedEntityId, company.id),
      ),
    );
  const eventCountsByType: Record<string, number> = {};
  for (const row of eventRows) {
    eventCountsByType[row.type] = (eventCountsByType[row.type] ?? 0) + 1;
  }

  const [intelligenceRow] = await db
    .select()
    .from(schema.companyIntelligence)
    .where(eq(schema.companyIntelligence.companyId, company.id))
    .limit(1);

  const signalRows = await db
    .select()
    .from(schema.signal)
    .where(eq(schema.signal.companyId, company.id));

  // Scoped to *this* scenario's own Opportunities, not merely to `userId`:
  // `runMatchingPipeline` evaluates a User against every `scored`
  // Opportunity in the database, not just the ones this scenario created
  // (that's real, intended cross-Company matching behavior). Since every
  // scenario in this file shares one database and one Skill taxonomy, a
  // later scenario's freshly-seeded User can legitimately also match
  // *earlier* scenarios' Opportunities — which would make this snapshot
  // grow with however many scenarios happened to run before it. Filtering
  // to this scenario's own `opportunityId`s is what isolates "did this
  // scenario's own pipeline run produce the same result" from that
  // (correct, but irrelevant here) cross-scenario contamination.
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
    sourceIdentityCount: sourceIdentityRows.length,
    eventCountsByType,
    intelligence: intelligenceRow
      ? {
          trend: intelligenceRow.trend,
          confidence: intelligenceRow.confidence,
          signalCount: intelligenceRow.signalCount,
          lastSignalAt: intelligenceRow.lastSignalAt
            ? intelligenceRow.lastSignalAt.getTime()
            : null,
          asOf: intelligenceRow.asOf.getTime(),
        }
      : null,
    signals: signalRows
      .map((row) => ({
        signalType: row.signalType,
        weight: row.weight,
        reasoning: row.reasoning,
        detectedAt: row.detectedAt.getTime(),
      }))
      .sort((a, b) => a.signalType.localeCompare(b.signalType) || a.detectedAt - b.detectedAt),
    opportunities: opportunityRows
      .map((row) => ({
        opportunityType: row.opportunityType,
        status: row.status,
        score: row.score,
        reasoning: row.reasoning,
        detectionWindow: row.detectionWindow,
        detectedAt: row.detectedAt.getTime(),
        scoredAt: row.scoredAt ? row.scoredAt.getTime() : null,
      }))
      .sort((a, b) => a.detectionWindow.localeCompare(b.detectionWindow)),
    matches: matchRows
      .map((row) => ({
        score: row.score,
        reasoning: row.reasoning,
        matchedSkillIds: [...row.matchedSkillIds].sort(),
        computedAt: row.computedAt.getTime(),
      }))
      .sort((a, b) => a.score - b.score),
    recommendations: recommendationRows
      .map((row) => ({
        status: row.status,
        priority: row.priority,
        reasonCode: row.reasonCode,
        reasonDetails: row.reasonDetails,
        reasonVersion: row.reasonVersion,
        createdAt: row.createdAt.getTime(),
        statusChangedAt: row.statusChangedAt.getTime(),
      }))
      .sort((a, b) => b.priority - a.priority),
  };
}

describe("multi-source pipeline (integration)", () => {
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

  it("resolves a company tracked across three Collectors to exactly one Company entity", async () => {
    const snapshot = await runScenario("merge-check", ["greenhouse", "lever", "ashby"]);
    expect(snapshot.sourceIdentityCount).toBe(3);
  });

  it(
    "replay determinism: running the identical scenario twice produces byte-identical " +
      "(content, not ID) Signals/Intelligence/Opportunities/Matches/Recommendations",
    async () => {
      const first = await runScenario("replay-run-a", ["greenhouse", "lever", "ashby"]);
      const second = await runScenario("replay-run-b", ["greenhouse", "lever", "ashby"]);

      expect(second).toEqual(first);
    },
    60_000,
  );

  it(
    "order independence: running Greenhouse/Lever/Ashby in a different order produces " +
      "identical results",
    async () => {
      const forward = await runScenario("order-forward", ["greenhouse", "lever", "ashby"]);
      const reversed = await runScenario("order-reversed", ["ashby", "lever", "greenhouse"]);

      expect(reversed).toEqual(forward);
    },
    60_000,
  );
});
