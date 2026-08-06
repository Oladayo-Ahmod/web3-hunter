import { runClassificationPipeline } from "@web3-hunter/classification";
import { getDb, schema } from "@web3-hunter/db";
import { runDecisionPipeline } from "@web3-hunter/decision";
import { runMatchingPipeline } from "@web3-hunter/matching";
import { runScoringPipeline } from "@web3-hunter/scoring";
import { runTechnologyPipeline } from "@web3-hunter/technology";
import { eq } from "drizzle-orm";
import {
  recordPipelineRun,
  type PipelineName,
  type PipelineRunScopeType,
} from "../observability/record-pipeline-run";

/**
 * The per-entity batch shape every recurring pipeline stage below shares:
 * run one deterministic pipeline once per row of some entity table,
 * isolating one entity's failure from the rest — the same discipline
 * `apps/web/lib/collectors/run-collector.ts` established for Collectors.
 * Extracted here, once, so `apps/web/scripts/run-*.ts` (CLI, human-
 * triggered) and `apps/web/app/api/cron/pipeline/route.ts` (HTTP,
 * cron-triggered) call the exact same logic rather than each
 * reimplementing this loop — see docs/ARCHITECTURE.md §3 on avoiding
 * duplicate abstractions.
 */
export type StageEntityResult<T> =
  { id: string; status: "ok"; result: T } | { id: string; status: "error"; error: string };

/**
 * Fires as each entity starts and finishes. This is the only way a caller
 * (a CLI script) gets real-time progress — `runForEachEntity` itself only
 * returns once every entity is done, which for a run against a remote
 * database with many rows can take a while. Without this hook, nothing
 * prints until the very end, indistinguishable from a hang.
 */
export interface StageProgress<T> {
  onStart?: (id: string) => void;
  onComplete?: (entry: StageEntityResult<T>) => void;
}

async function runForEachEntity<T>(
  ids: readonly string[],
  run: (id: string) => Promise<T>,
  progress?: StageProgress<T>,
): Promise<StageEntityResult<T>[]> {
  const results: StageEntityResult<T>[] = [];

  for (const id of ids) {
    progress?.onStart?.(id);

    let entry: StageEntityResult<T>;
    try {
      entry = { id, status: "ok", result: await run(id) };
    } catch (error) {
      entry = {
        id,
        status: "error",
        error: error instanceof Error ? error.message : String(error),
      };
    }

    results.push(entry);
    progress?.onComplete?.(entry);
  }

  return results;
}

function recordAndRun<T extends object>(
  pipelineName: PipelineName,
  scopeType: PipelineRunScopeType,
  id: string,
  run: () => Promise<T>,
) {
  return recordPipelineRun({ pipelineName, scopeType, scopeId: id }, run);
}

/** Signal generation, Company Intelligence, and Opportunity detection for every Company. */
export async function scoreAllCompanies(
  progress?: StageProgress<Awaited<ReturnType<typeof runScoringPipeline>>>,
) {
  const companies = await getDb().select({ id: schema.company.id }).from(schema.company);
  return runForEachEntity(
    companies.map((c) => c.id),
    (id) => recordAndRun("scoring", "company", id, () => runScoringPipeline(id)),
    progress,
  );
}

/** Classifies every `scored` Opportunity that hasn't been classified yet. */
export async function classifyAllOpportunities(
  progress?: StageProgress<Awaited<ReturnType<typeof runClassificationPipeline>>>,
) {
  const opportunities = await getDb()
    .select({ id: schema.opportunity.id })
    .from(schema.opportunity)
    .where(eq(schema.opportunity.status, "scored"));
  return runForEachEntity(
    opportunities.map((o) => o.id),
    (id) => recordAndRun("classification", "opportunity", id, () => runClassificationPipeline(id)),
    progress,
  );
}

/** Technology detection for every Company. */
export async function detectTechnologyForAllCompanies(
  progress?: StageProgress<Awaited<ReturnType<typeof runTechnologyPipeline>>>,
) {
  const companies = await getDb().select({ id: schema.company.id }).from(schema.company);
  return runForEachEntity(
    companies.map((c) => c.id),
    (id) => recordAndRun("technology", "company", id, () => runTechnologyPipeline(id)),
    progress,
  );
}

/** Recomputes Matches for every User with a Profile. */
export async function matchAllUsers(
  progress?: StageProgress<Awaited<ReturnType<typeof runMatchingPipeline>>>,
) {
  const profiles = await getDb()
    .select({ userId: schema.userProfile.userId })
    .from(schema.userProfile);
  return runForEachEntity(
    profiles.map((p) => p.userId),
    (id) => recordAndRun("matching", "user", id, () => runMatchingPipeline(id)),
    progress,
  );
}

/** Evaluates Recommendation creation, priority refresh, and staleness expiration for every User with a Profile. */
export async function decideForAllUsers(
  progress?: StageProgress<Awaited<ReturnType<typeof runDecisionPipeline>>>,
) {
  const profiles = await getDb()
    .select({ userId: schema.userProfile.userId })
    .from(schema.userProfile);
  return runForEachEntity(
    profiles.map((p) => p.userId),
    (id) => recordAndRun("decision", "user", id, () => runDecisionPipeline(id)),
    progress,
  );
}
