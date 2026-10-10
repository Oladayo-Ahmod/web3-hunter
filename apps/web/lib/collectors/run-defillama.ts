import { defillama } from "@web3-hunter/collectors";
import { getDb, resolveOrCreateCollector, schema } from "@web3-hunter/db";
import { runIngestionPipeline, storeRawRecords } from "@web3-hunter/ingestion";
import { resolveSecurityTarget } from "@web3-hunter/security";
import { eq } from "drizzle-orm";

/**
 * A relevance floor, not a security judgment — see Phase 2A's research
 * report, "A feed containing 10,000 protocols is useless if it does not
 * help the researcher identify the 5 worth investigating." Without it,
 * every one of DefiLlama's ~8,500 listed protocols (most carrying
 * negligible or zero TVL) would get its own Security Target row and its
 * own sequential identity-resolution round trip on every run. Revisit if
 * a significant but low-TVL protocol turns out to be a real false
 * negative — this is a starting point, not a calibrated cutoff.
 */
const MIN_TVL_FOR_TRACKING = 1_000_000;

/** How many protocols' identity resolution runs concurrently within one batch — mirrors `run-collector.ts`'s `FETCH_CONCURRENCY`. */
const RESOLVE_CONCURRENCY = 10;

function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

export interface RunDefiLlamaCollectorResult {
  fetched: number;
  tracked: number;
  /** ProtocolSnapshotRecorded + ProtocolSnapshotUpdated events published. */
  published: number;
  /** Raw Records that produced no event (no meaningful change). */
  skipped: number;
}

/**
 * The composition root for the DefiLlama security-intelligence Collector
 * — mirrors `run-github.ts`'s shape (built directly on
 * `packages/ingestion`'s source-agnostic primitives, not
 * `run-collector.ts`'s `CollectorSourceConfig<TRecord>`, which is scoped
 * to the hiring domain's per-Company `TrackedCompany` concept). DefiLlama
 * exposes one global snapshot covering every protocol it tracks, not a
 * per-company board — so there is no `TrackedCompany`-equivalent input
 * here; every protocol above `MIN_TVL_FOR_TRACKING` is its own tracked
 * entity, scoped by its own DefiLlama `slug` as both `externalId` and
 * `sourceIdentifier` (see `packages/ingestion`'s ADR 0002 — a
 * `sourceIdentifier` is required to scope Raw Records and ingestion to
 * one tracked entity; here, that entity is the protocol itself).
 *
 * Deliberately does *not* run `@web3-hunter/security`'s
 * `runSecurityScoringPipeline` — ingestion and detection stay separate,
 * explicitly-triggered steps, the same discipline every other Collector
 * in this system follows (see `run-github.ts`'s own doc comment).
 */
export async function runDefiLlamaCollector(): Promise<RunDefiLlamaCollectorResult> {
  const collectorId = await resolveOrCreateCollector(getDb(), "defillama", "security-intelligence");

  try {
    const protocols = await defillama.fetchDefiLlamaProtocols();
    const tracked = protocols.filter((protocol) => (protocol.tvl ?? 0) >= MIN_TVL_FOR_TRACKING);

    const securityTargetIdBySlug = new Map<string, string>();
    for (const batch of chunk(tracked, RESOLVE_CONCURRENCY)) {
      const resolved = await Promise.all(
        batch.map(async (protocol) => {
          // Populated at creation time whenever DefiLlama's own payload
          // names a GitHub organization — the same derivation
          // `run-immunefi.ts`'s post-collision repair already reuses.
          // `createSecurityTarget`'s `onConflictDoNothing` on `slug`
          // means this can never overwrite an existing Target's
          // `repositoryUrl` on a re-poll; it only ever fills it in for a
          // genuinely new row.
          const securityTargetId = await resolveSecurityTarget(collectorId, protocol.slug, {
            slug: protocol.slug,
            name: protocol.name,
            repositoryUrl: defillama.deriveRepositoryUrlFromDefiLlamaPayload(protocol),
            discoverySource: "defillama-protocols",
            discoveredAt: new Date(),
          });
          return [protocol.slug, securityTargetId] as const;
        }),
      );
      for (const [slug, securityTargetId] of resolved) {
        securityTargetIdBySlug.set(slug, securityTargetId);
      }
    }

    // One batched write for the whole poll, not one per protocol — see
    // `storeRawRecords`'s doc comment for why a per-record loop here would
    // repeat the exact Supabase-egress mistake Milestone 25 fixed.
    await storeRawRecords(
      tracked.map((protocol) => ({
        collectorId,
        payload: protocol,
        externalId: protocol.slug,
        sourceIdentifier: protocol.slug,
      })),
    );

    let published = 0;
    let skipped = 0;

    for (const protocol of tracked) {
      const securityTargetId = securityTargetIdBySlug.get(protocol.slug);
      if (!securityTargetId) {
        continue;
      }

      const pipelineResult = await runIngestionPipeline({
        collectorId,
        sourceIdentifier: protocol.slug,
        normalize: defillama.createDefiLlamaProtocolNormalizer(securityTargetId),
      });

      published += pipelineResult.published;
      skipped += pipelineResult.skipped;
    }

    await recordRunSuccess(collectorId, {
      recordsProcessed: tracked.length,
      recordsPublished: published,
    });

    return { fetched: protocols.length, tracked: tracked.length, published, skipped };
  } catch (error) {
    await recordRunFailure(collectorId, error instanceof Error ? error.message : String(error));
    throw error;
  }
}

/** Records a successful Collector Health snapshot — mirrors `run-github.ts`'s `recordRunHealth` success branch. */
async function recordRunSuccess(
  collectorId: string,
  health: { recordsProcessed: number; recordsPublished: number },
): Promise<void> {
  await getDb()
    .update(schema.collector)
    .set({
      status: "active",
      lastRunAt: new Date(),
      consecutiveFailures: 0,
      lastRunRecordsProcessed: health.recordsProcessed,
      lastRunRecordsPublished: health.recordsPublished,
    })
    .where(eq(schema.collector.id, collectorId));
}

/** Records a failed run, incrementing `consecutiveFailures` — mirrors `run-github.ts`'s `recordRunHealth` failure branch. */
async function recordRunFailure(collectorId: string, message: string): Promise<void> {
  const db = getDb();
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
      lastErrorMessage: message,
      consecutiveFailures: (current?.consecutiveFailures ?? 0) + 1,
    })
    .where(eq(schema.collector.id, collectorId));
}
