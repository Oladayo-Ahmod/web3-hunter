import { getDb, resolveOrCreateCollector, schema } from "@web3-hunter/db";
import {
  reconcileMissingRecords,
  runIngestionPipeline,
  storeRawRecords,
  type NormalizedEvent,
  type Normalizer,
} from "@web3-hunter/ingestion";
import { and, eq } from "drizzle-orm";

export interface TrackedCompany {
  /** Our own canonical, cross-source identifier for this company (see docs/DATABASE.md §9). */
  companySlug: string;
  companyName: string;
  /**
   * This Collector's own identifier for the company — a Greenhouse board
   * token, a Lever site slug, an Ashby job board name. Paired with the
   * Collector itself, this is the source-specific half of the
   * `company_source_identity` mapping (see that table's doc comment).
   */
  sourceIdentifier: string;
}

/**
 * Everything source-specific a Collector contributes to a run. Per
 * Milestone 8's Definition of Ready ("treat normalization as the canonical
 * boundary"), this is the *entire* extension surface: `runCollector` below
 * never branches on which source it's running, so adding a fourth ATS
 * means implementing this interface and registering the result — nothing
 * in this file changes.
 */
export interface CollectorSourceConfig<TRecord> {
  /** A stable, human-readable identifier for this Collector, e.g. "greenhouse". */
  slug: string;
  /** The kind of external source this Collector integrates with, e.g. "ats". */
  sourceType: string;
  fetchRecords: (sourceIdentifier: string) => Promise<TRecord[]>;
  externalIdOf: (record: TRecord) => string;
  createNormalizer: (companyId: string) => Normalizer;
  createClosedNormalizer: (
    companyId: string,
  ) => (input: { externalId: string; lastKnownPayload: unknown }) => NormalizedEvent | null;
}

export type RunCollectorResult =
  | {
      companySlug: string;
      status: "ok";
      fetched: number;
      /** JobPosted + JobUpdated events published (or this source's equivalent). */
      published: number;
      /** Raw Records that produced no event (no meaningful change). */
      skipped: number;
      /** JobClosed events published for roles no longer present. */
      closed: number;
    }
  | { companySlug: string; status: "error"; message: string };

/** How many companies' external fetches run concurrently within one batch — see the ADR referenced below for why this is the only step parallelized. */
const FETCH_CONCURRENCY = 5;

function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

type FetchOutcome<TRecord> =
  | { status: "fetched"; companyId: string; records: TRecord[] }
  | { status: "error"; message: string };

/**
 * The generic composition root every ATS Collector runs through: resolves
 * the shared `collector` row, resolves each tracked company's `company`
 * row through the explicit `company_source_identity` mapping, fetches +
 * normalizes + publishes each company's records via `packages/ingestion`,
 * then records exactly one run-level Collector Health snapshot. This is
 * the one piece of direct database access this orchestration needs, which
 * is why it lives in `apps/web` rather than `packages/collectors` — see
 * docs/ARCHITECTURE.md §9, "Collectors never persist or publish directly."
 *
 * A single company's failure never aborts the run for the others — it's
 * recorded and the loop continues, per Milestone 2's original acceptance
 * criteria. Health is now aggregated once per full run rather than
 * overwritten per company mid-run, which was the pre-Milestone-8 bug.
 *
 * Two distinct phases, deliberately not merged — see
 * docs/adr/0001-fetch-only-collector-concurrency.md for the full
 * reasoning:
 *
 * 1. Resolve + fetch, in bounded concurrent batches. Purely network- and
 *    read-bound, and safe to parallelize: each company resolves its own
 *    `company_source_identity` row (keyed by its own `sourceIdentifier`,
 *    never shared with another company) and fetches from its own
 *    external endpoint. Nothing here touches state another company's
 *    fetch could race on.
 * 2. Persist, ingest, and reconcile, sequentially, in the original input
 *    order — exactly as before this milestone. `packages/ingestion`'s
 *    `runIngestionPipeline`/`reconcileMissingRecords` scope their
 *    "unprocessed" and "still tracked" queries by Collector only, not by
 *    Company (verified directly against that package's source, not
 *    assumed) — running this phase concurrently across companies sharing
 *    one Collector would let one company's still-processing Raw Records
 *    be picked up and misattributed by another company's normalizer, or
 *    have its still-open roles reconciled as "closed" under the wrong
 *    Company. `packages/ingestion` is intentionally out of scope for this
 *    milestone, so this phase stays exactly as sequential as it always
 *    was rather than working around that.
 */
export async function runCollector<TRecord>(
  config: CollectorSourceConfig<TRecord>,
  companies: readonly TrackedCompany[],
): Promise<RunCollectorResult[]> {
  const startedAt = Date.now();
  const collectorId = await resolveOrCreateCollector(getDb(), config.slug, config.sourceType);
  const results: RunCollectorResult[] = [];
  const errors: string[] = [];
  let recordsProcessed = 0;
  let recordsPublished = 0;

  const fetchOutcomes = new Map<string, FetchOutcome<TRecord>>();

  for (const batch of chunk(companies, FETCH_CONCURRENCY)) {
    const batchOutcomes = await Promise.all(
      batch.map(async (trackedCompany): Promise<[string, FetchOutcome<TRecord>]> => {
        try {
          const companyId = await resolveCompany(collectorId, trackedCompany);
          const records = await config.fetchRecords(trackedCompany.sourceIdentifier);
          return [trackedCompany.companySlug, { status: "fetched", companyId, records }];
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return [trackedCompany.companySlug, { status: "error", message }];
        }
      }),
    );

    for (const [companySlug, outcome] of batchOutcomes) {
      fetchOutcomes.set(companySlug, outcome);
    }
  }

  for (const trackedCompany of companies) {
    const outcome = fetchOutcomes.get(trackedCompany.companySlug);

    if (!outcome || outcome.status === "error") {
      const message = outcome?.message ?? "Fetch outcome missing.";
      errors.push(`${trackedCompany.companySlug}: ${message}`);
      results.push({ companySlug: trackedCompany.companySlug, status: "error", message });
      continue;
    }

    try {
      const result = await persistAndIngest(
        collectorId,
        config,
        trackedCompany.companySlug,
        trackedCompany.sourceIdentifier,
        outcome.companyId,
        outcome.records,
      );
      results.push(result);
      recordsProcessed += result.fetched;
      recordsPublished += result.published + result.closed;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${trackedCompany.companySlug}: ${message}`);
      results.push({ companySlug: trackedCompany.companySlug, status: "error", message });
    }
  }

  await recordRunHealth(collectorId, {
    durationMs: Date.now() - startedAt,
    recordsProcessed,
    recordsPublished,
    errors,
    successCount: results.filter((result) => result.status === "ok").length,
    totalCount: results.length,
  });

  return results;
}

/**
 * The sequential half of a company's run: store what was already fetched,
 * run it through the Ingestion Pipeline, then reconcile disappeared
 * records. Deliberately never runs concurrently with another company's
 * call to this function — see `runCollector`'s doc comment.
 */
async function persistAndIngest<TRecord>(
  collectorId: string,
  config: CollectorSourceConfig<TRecord>,
  companySlug: string,
  sourceIdentifier: string,
  companyId: string,
  records: readonly TRecord[],
): Promise<Extract<RunCollectorResult, { status: "ok" }>> {
  // Milestone 25: one batched call instead of one `storeRawRecord` round
  // trip per job — see `storeRawRecords`'s doc comment. This was the
  // dominant cost behind the ATS Collectors' real 5-25 minute runtimes
  // (companies with hundreds of open roles meant hundreds of sequential
  // network round trips to Supabase per company); batching changes
  // nothing about *what* gets written or its dedup guarantees, only how
  // many round trips it costs.
  if (records.length > 0) {
    await storeRawRecords(
      records.map((record) => ({
        collectorId,
        payload: record,
        externalId: config.externalIdOf(record),
        sourceIdentifier,
      })),
    );
  }

  const pipelineResult = await runIngestionPipeline({
    collectorId,
    sourceIdentifier,
    normalize: config.createNormalizer(companyId),
  });

  const closedResult = await reconcileMissingRecords({
    collectorId,
    sourceIdentifier,
    currentExternalIds: records.map(config.externalIdOf),
    normalizeMissing: config.createClosedNormalizer(companyId),
  });

  return {
    companySlug,
    status: "ok",
    fetched: records.length,
    published: pipelineResult.published,
    skipped: pipelineResult.skipped,
    closed: closedResult.published,
  };
}

/**
 * Resolves a tracked company's Company row through the explicit
 * `company_source_identity` mapping: if this Collector has already
 * declared `sourceIdentifier` to mean a particular Company, reuse it.
 * Otherwise resolve/create the Company by its canonical `slug` (unchanged
 * since Milestone 2) and record the mapping, so this run and every future
 * one — and every other Collector configured with the same `companySlug`
 * — resolve to the identical Company deterministically, regardless of
 * ingestion order.
 */
async function resolveCompany(
  collectorId: string,
  trackedCompany: TrackedCompany,
): Promise<string> {
  const db = getDb();

  const [existingIdentity] = await db
    .select()
    .from(schema.companySourceIdentity)
    .where(
      and(
        eq(schema.companySourceIdentity.collectorId, collectorId),
        eq(schema.companySourceIdentity.sourceIdentifier, trackedCompany.sourceIdentifier),
      ),
    )
    .limit(1);

  if (existingIdentity) {
    return existingIdentity.companyId;
  }

  const companyId = await resolveCompanyBySlug(
    trackedCompany.companySlug,
    trackedCompany.companyName,
  );

  await db
    .insert(schema.companySourceIdentity)
    .values({
      collectorId,
      sourceIdentifier: trackedCompany.sourceIdentifier,
      companyId,
    })
    .onConflictDoNothing({
      target: [
        schema.companySourceIdentity.collectorId,
        schema.companySourceIdentity.sourceIdentifier,
      ],
    });

  return companyId;
}

async function resolveCompanyBySlug(slug: string, name: string): Promise<string> {
  const db = getDb();

  const [created] = await db
    .insert(schema.company)
    .values({ slug, name })
    .onConflictDoNothing({ target: schema.company.slug })
    .returning();

  if (created) {
    return created.id;
  }

  const [existing] = await db
    .select()
    .from(schema.company)
    .where(eq(schema.company.slug, slug))
    .limit(1);

  if (!existing) {
    throw new Error(`Failed to resolve company "${slug}".`);
  }

  return existing.id;
}

interface RunHealth {
  durationMs: number;
  recordsProcessed: number;
  recordsPublished: number;
  errors: readonly string[];
  /** How many tracked Companies this run fetched/persisted/ingested without error. */
  successCount: number;
  /** How many tracked Companies this run attempted in total (`successCount` + failures). */
  totalCount: number;
}

/**
 * Records exactly one Collector Health snapshot per full run — the fix for
 * the pre-Milestone-8 bug where each company's outcome overwrote the
 * previous one mid-run.
 *
 * Milestone 25 (governing directive Part C): three distinct run outcomes,
 * not two. A real production audit found a handful of permanently dead
 * company boards (404s from a renamed/removed ATS board) holding
 * `lastRunAt` frozen for *weeks* and `status` stuck on "degraded" even
 * while every other tracked Company kept publishing fresh JobPosted/
 * JobUpdated Events run after run — because the previous version of this
 * function only ever advanced `lastRunAt` on a *zero-error* run. A
 * Collector tracking 100 Companies where 1 permanently 404s would never
 * again report a fresh `lastRunAt`, making the freshness signal
 * (`pipeline-health-service.ts`'s `isStale`) actively wrong: it would
 * flag a Collector as stale while it was, in fact, successfully
 * publishing new job data every single run.
 *
 * - **Successful run** (`errors.length === 0`): `status: "active"`,
 *   `lastRunAt` advances, `consecutiveFailures` resets to 0.
 * - **Partial run** (`successCount > 0` but some Companies errored):
 *   `status: "degraded"` (still worth a human's attention — the error
 *   log and `consecutiveFailures` streak are unchanged from before) BUT
 *   `lastRunAt` **still advances**, because real, fresh data was
 *   collected for every Company that didn't fail. This is the actual
 *   fix: staleness must reflect "is this Collector still doing its job,"
 *   not "did every single tracked Company succeed."
 * - **Failed run** (`successCount === 0`, i.e. every tracked Company
 *   failed — a systemic problem, not a handful of dead boards):
 *   `status: "degraded"`, `lastRunAt` does **not** advance. This is the
 *   only case where staleness should genuinely be flagged, since no new
 *   data came in at all.
 */
async function recordRunHealth(collectorId: string, health: RunHealth): Promise<void> {
  const db = getDb();

  if (health.errors.length === 0) {
    await db
      .update(schema.collector)
      .set({
        status: "active",
        lastRunAt: new Date(),
        consecutiveFailures: 0,
        lastRunRecordsProcessed: health.recordsProcessed,
        lastRunRecordsPublished: health.recordsPublished,
        lastRunDurationMs: health.durationMs,
      })
      .where(eq(schema.collector.id, collectorId));
    return;
  }

  const [current] = await db
    .select({ consecutiveFailures: schema.collector.consecutiveFailures })
    .from(schema.collector)
    .where(eq(schema.collector.id, collectorId))
    .limit(1);

  const madeProgress = health.successCount > 0;

  await db
    .update(schema.collector)
    .set({
      status: "degraded",
      // A partial run's `lastRunAt` still advances — see this function's
      // doc comment. Only a total failure (zero successes) leaves it
      // untouched, which is what correctly makes staleness detection
      // fire for a genuinely broken Collector instead of one with a
      // handful of permanently dead boards mixed into a healthy run.
      ...(madeProgress ? { lastRunAt: new Date() } : {}),
      lastErrorAt: new Date(),
      lastErrorMessage: health.errors.join("; "),
      consecutiveFailures: (current?.consecutiveFailures ?? 0) + 1,
      lastRunRecordsProcessed: health.recordsProcessed,
      lastRunRecordsPublished: health.recordsPublished,
      lastRunDurationMs: health.durationMs,
    })
    .where(eq(schema.collector.id, collectorId));
}
