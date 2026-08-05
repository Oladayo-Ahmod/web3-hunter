import { getDb, schema } from "@web3-hunter/db";
import {
  reconcileMissingRecords,
  runIngestionPipeline,
  storeRawRecord,
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
 */
export async function runCollector<TRecord>(
  config: CollectorSourceConfig<TRecord>,
  companies: readonly TrackedCompany[],
): Promise<RunCollectorResult[]> {
  const startedAt = Date.now();
  const collectorId = await resolveCollector(config.slug, config.sourceType);
  const results: RunCollectorResult[] = [];
  const errors: string[] = [];
  let recordsProcessed = 0;
  let recordsPublished = 0;

  for (const trackedCompany of companies) {
    try {
      const result = await runForCompany(collectorId, config, trackedCompany);
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
  });

  return results;
}

async function runForCompany<TRecord>(
  collectorId: string,
  config: CollectorSourceConfig<TRecord>,
  trackedCompany: TrackedCompany,
): Promise<Extract<RunCollectorResult, { status: "ok" }>> {
  const companyId = await resolveCompany(collectorId, trackedCompany);
  const records = await config.fetchRecords(trackedCompany.sourceIdentifier);

  for (const record of records) {
    await storeRawRecord({
      collectorId,
      payload: record,
      externalId: config.externalIdOf(record),
    });
  }

  const pipelineResult = await runIngestionPipeline({
    collectorId,
    normalize: config.createNormalizer(companyId),
  });

  const closedResult = await reconcileMissingRecords({
    collectorId,
    currentExternalIds: records.map(config.externalIdOf),
    normalizeMissing: config.createClosedNormalizer(companyId),
  });

  return {
    companySlug: trackedCompany.companySlug,
    status: "ok",
    fetched: records.length,
    published: pipelineResult.published,
    skipped: pipelineResult.skipped,
    closed: closedResult.published,
  };
}

async function resolveCollector(slug: string, sourceType: string): Promise<string> {
  const db = getDb();

  const [created] = await db
    .insert(schema.collector)
    .values({ slug, sourceType })
    .onConflictDoNothing({ target: schema.collector.slug })
    .returning();

  if (created) {
    return created.id;
  }

  const [existing] = await db
    .select()
    .from(schema.collector)
    .where(eq(schema.collector.slug, slug))
    .limit(1);

  if (!existing) {
    throw new Error(`Failed to resolve the "${slug}" collector row.`);
  }

  return existing.id;
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
}

/**
 * Records exactly one Collector Health snapshot per full run — the fix for
 * the pre-Milestone-8 bug where each company's outcome overwrote the
 * previous one mid-run. A run counts as a "successful run" only if every
 * tracked company in it succeeded; any single company's failure marks the
 * whole run as the "last failed run", increments `consecutiveFailures`,
 * and cites every failing company's error (not just the last one) — this
 * is a deliberate run-level definition of health, not a per-company one.
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

  await db
    .update(schema.collector)
    .set({
      status: "degraded",
      lastErrorAt: new Date(),
      lastErrorMessage: health.errors.join("; "),
      consecutiveFailures: (current?.consecutiveFailures ?? 0) + 1,
      lastRunRecordsProcessed: health.recordsProcessed,
      lastRunRecordsPublished: health.recordsPublished,
      lastRunDurationMs: health.durationMs,
    })
    .where(eq(schema.collector.id, collectorId));
}
