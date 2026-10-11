import { defillama } from "@web3-hunter/collectors";
import { getDb, schema } from "@web3-hunter/db";
import { runIngestionPipeline } from "@web3-hunter/ingestion";
import { and, eq, isNull } from "drizzle-orm";

const DEFAULT_BATCH_SIZE = 100;

export interface ResumeDefiLlamaIngestionOptions {
  /** Read-only eligibility/mapping checks only — never calls `runIngestionPipeline`. */
  dryRun?: boolean;
  /** How many eligible source identifiers to process in this invocation. Defaults to 100, matching the deliberately conservative batch size that avoids re-exercising the long unbounded sequential loop that produced the original statement timeout. */
  batchSize?: number;
}

export type ResumeDefiLlamaIngestionExclusionReason =
  "no-source-identity-mapping" | "missing-security-target";

export interface ResumeDefiLlamaIngestionExclusion {
  sourceIdentifier: string;
  reason: ResumeDefiLlamaIngestionExclusionReason;
}

export interface ResumeDefiLlamaIngestionFailure {
  sourceIdentifier: string;
  message: string;
}

export interface ResumeDefiLlamaIngestionResult {
  /** Source identifiers with at least one not-yet-ingested raw record AND a verified, existing target mapping. */
  eligible: number;
  /** Source identifiers that had a not-yet-ingested raw record but no verifiable existing target mapping — never processed, never repaired. */
  excluded: ResumeDefiLlamaIngestionExclusion[];
  /** How many eligible identifiers this invocation actually attempted (bounded by `batchSize`). 0 in dry-run mode. */
  attempted: number;
  succeeded: number;
  failed: ResumeDefiLlamaIngestionFailure[];
  /** Eligible identifiers not yet resolved after this invocation (including any that failed) — what a follow-up invocation would still pick up. */
  remaining: number;
}

/**
 * Resumes DefiLlama ingestion for raw records that were persisted but
 * never processed into an Event — e.g. after a crash partway through
 * `runDefiLlamaCollector`'s per-protocol ingestion loop (see Stage 15/16's
 * investigation of a `57014` statement timeout mid-run). Deliberately
 * narrower than re-running the collector:
 *
 * - Never calls DefiLlama's API (`@web3-hunter/collectors`'s `fetch`
 *   module is not imported here at all) — only the already-persisted
 *   `raw_record.payload` is used, via `runIngestionPipeline`'s own
 *   existing, unmodified read path.
 * - Never calls `resolveSecurityTarget`/`resolveSecurityTargetWithCollisionCheck`
 *   or `createSecurityTarget` — target/identity resolution already
 *   completed for every one of these records before the original run
 *   crashed (Stage 16 confirmed this), so this only *reads* the existing
 *   `security_target_source_identity` mapping, never creates, merges, or
 *   repairs one.
 * - Never updates `security_target.repositoryUrl`/`discoverySource` or
 *   any other target metadata, and never touches `bug_bounty` or any
 *   Immunefi-owned row — those tables are not referenced anywhere in
 *   this file.
 *
 * Eligibility is computed fresh from persisted state on every call
 * (never a hardcoded list): a source identifier is eligible only if (a)
 * it has at least one `raw_record` with no corresponding
 * `raw_record_ingestion` row, and (b) a `security_target_source_identity`
 * row already maps it to a `security_target` that still exists. Anything
 * failing (b) is excluded and reported, never guessed.
 */
export async function resumeDefiLlamaIngestion(
  options: ResumeDefiLlamaIngestionOptions = {},
): Promise<ResumeDefiLlamaIngestionResult> {
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  if (!Number.isInteger(batchSize) || batchSize < 1) {
    throw new Error(`batchSize must be a positive integer, received: ${String(options.batchSize)}`);
  }

  const db = getDb();

  const [collector] = await db
    .select({ id: schema.collector.id })
    .from(schema.collector)
    .where(eq(schema.collector.slug, "defillama"));

  if (!collector) {
    return { eligible: 0, excluded: [], attempted: 0, succeeded: 0, failed: [], remaining: 0 };
  }

  // Every distinct DefiLlama sourceIdentifier with at least one raw_record
  // lacking a raw_record_ingestion row — the same "not yet processed"
  // condition `runIngestionPipeline` itself checks per-record, grouped so
  // each identifier can be resumed independently.
  const pendingRows = await db
    .selectDistinct({ sourceIdentifier: schema.rawRecord.sourceIdentifier })
    .from(schema.rawRecord)
    .leftJoin(
      schema.rawRecordIngestion,
      eq(schema.rawRecordIngestion.rawRecordId, schema.rawRecord.id),
    )
    .where(
      and(
        eq(schema.rawRecord.collectorId, collector.id),
        isNull(schema.rawRecordIngestion.rawRecordId),
      ),
    );

  const pendingIdentifiers = pendingRows
    .map((row) => row.sourceIdentifier)
    .filter((identifier): identifier is string => identifier !== null);

  const excluded: ResumeDefiLlamaIngestionExclusion[] = [];
  const eligibleTargetBySourceIdentifier = new Map<string, string>();

  for (const sourceIdentifier of pendingIdentifiers) {
    const [identity] = await db
      .select({ securityTargetId: schema.securityTargetSourceIdentity.securityTargetId })
      .from(schema.securityTargetSourceIdentity)
      .where(
        and(
          eq(schema.securityTargetSourceIdentity.collectorId, collector.id),
          eq(schema.securityTargetSourceIdentity.sourceIdentifier, sourceIdentifier),
        ),
      );

    if (!identity) {
      excluded.push({ sourceIdentifier, reason: "no-source-identity-mapping" });
      continue;
    }

    const [target] = await db
      .select({ id: schema.securityTarget.id })
      .from(schema.securityTarget)
      .where(eq(schema.securityTarget.id, identity.securityTargetId));

    if (!target) {
      excluded.push({ sourceIdentifier, reason: "missing-security-target" });
      continue;
    }

    eligibleTargetBySourceIdentifier.set(sourceIdentifier, target.id);
  }

  const eligible = eligibleTargetBySourceIdentifier.size;

  if (options.dryRun) {
    return { eligible, excluded, attempted: 0, succeeded: 0, failed: [], remaining: eligible };
  }

  const batch = [...eligibleTargetBySourceIdentifier.entries()].slice(0, batchSize);
  let succeeded = 0;
  const failed: ResumeDefiLlamaIngestionFailure[] = [];

  // Sequential, not concurrent — deliberately more conservative than
  // `runDefiLlamaCollector`'s own `RESOLVE_CONCURRENCY`-chunked identity
  // resolution, to minimize connection pressure on a resume path whose
  // whole purpose is recovering from a prior statement timeout.
  for (const [sourceIdentifier, securityTargetId] of batch) {
    try {
      await runIngestionPipeline({
        collectorId: collector.id,
        sourceIdentifier,
        normalize: defillama.createDefiLlamaProtocolNormalizer(securityTargetId),
      });
      succeeded += 1;
    } catch (error) {
      failed.push({
        sourceIdentifier,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    eligible,
    excluded,
    attempted: batch.length,
    succeeded,
    failed,
    remaining: eligible - succeeded,
  };
}
