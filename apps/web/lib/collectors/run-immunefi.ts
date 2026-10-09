import { defillama, immunefi } from "@web3-hunter/collectors";
import { getDb, resolveOrCreateCollector, schema } from "@web3-hunter/db";
import { runIngestionPipeline, storeRawRecords } from "@web3-hunter/ingestion";
import {
  SecurityTargetIdentityCollisionError,
  getRawPayloadFromCollector,
  getSecurityTargetBySlug,
  resolveSecurityTargetWithCollisionCheck,
  updateSecurityTargetRepositoryUrlIfMissing,
  upsertBugBounty,
} from "@web3-hunter/security";
import { eq } from "drizzle-orm";

/** How many programs' identity resolution runs concurrently within one batch — mirrors `run-defillama.ts`'s `RESOLVE_CONCURRENCY`. */
const RESOLVE_CONCURRENCY = 10;

function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

/** Immunefi's own, documented, stable URL convention for a program's public page — not given directly by the API, but a known platform convention, not a guess about any one program's content. */
function immunefiProgramUrl(slug: string): string {
  return `https://immunefi.com/bug-bounty/${slug}/`;
}

export interface ImmunefiCollisionResult {
  slug: string;
  message: string;
}

const DEFILLAMA_COLLECTOR_SLUG = "defillama";

/**
 * On an identity collision, attempts exactly one narrowly-scoped repair
 * before giving up: if (a) Immunefi itself supplies repository evidence
 * for this program, and (b) the reason for the collision is specifically
 * that the *existing* (DefiLlama-created) Security Target has no
 * repository evidence at all — not a confirmed mismatch — look up
 * DefiLlama's own already-stored Raw Record for that same slug (no live
 * HTTP request) and, if it names a GitHub organization, attach it to
 * the existing Target and retry once.
 *
 * Deliberately does nothing in every other case: a confirmed mismatch
 * (both sides have evidence and it differs) is never retried — retrying
 * would only ever reproduce the same mismatch, since this repair cannot
 * change *Immunefi's* side of the comparison. A program with no
 * `githubUrl` of its own is skipped for the same reason — there would be
 * nothing to compare the repaired evidence against.
 */
async function resolveWithIdentityRepair(
  collectorId: string,
  bounty: { slug: string; project: string; githubUrl: string | null },
): Promise<{ securityTargetId: string | null; collisionMessage: string | null }> {
  try {
    const securityTargetId = await resolveSecurityTargetWithCollisionCheck(
      collectorId,
      bounty.slug,
      {
        slug: bounty.slug,
        name: bounty.project,
        repositoryUrl: bounty.githubUrl,
        discoverySource: "immunefi-bounties",
        discoveredAt: new Date(),
      },
    );
    return { securityTargetId, collisionMessage: null };
  } catch (error) {
    if (!(error instanceof SecurityTargetIdentityCollisionError)) {
      throw error;
    }

    if (!bounty.githubUrl) {
      return { securityTargetId: null, collisionMessage: error.message };
    }

    const existingTarget = await getSecurityTargetBySlug(bounty.slug);
    if (!existingTarget || existingTarget.repositoryUrl !== null) {
      // Either the collision already resolved itself concurrently, or
      // the existing Target already has (conflicting) evidence — a
      // confirmed mismatch, not a repairable gap. Never retry.
      return { securityTargetId: null, collisionMessage: error.message };
    }

    const defiLlamaPayload = await getRawPayloadFromCollector(
      existingTarget.id,
      DEFILLAMA_COLLECTOR_SLUG,
    );
    const repairedUrl = defiLlamaPayload
      ? defillama.deriveRepositoryUrlFromDefiLlamaPayload(defiLlamaPayload)
      : null;

    if (!repairedUrl) {
      return { securityTargetId: null, collisionMessage: error.message };
    }

    await updateSecurityTargetRepositoryUrlIfMissing(existingTarget.id, repairedUrl);

    try {
      const securityTargetId = await resolveSecurityTargetWithCollisionCheck(
        collectorId,
        bounty.slug,
        {
          slug: bounty.slug,
          name: bounty.project,
          repositoryUrl: bounty.githubUrl,
          discoverySource: "immunefi-bounties",
          discoveredAt: new Date(),
        },
      );
      return { securityTargetId, collisionMessage: null };
    } catch (retryError) {
      if (retryError instanceof SecurityTargetIdentityCollisionError) {
        return { securityTargetId: null, collisionMessage: retryError.message };
      }
      throw retryError;
    }
  }
}

export interface RunImmunefiCollectorResult {
  fetched: number;
  /** BountyProgramRecorded + BountyProgramUpdated events published. */
  published: number;
  /** Raw Records that produced no event (no meaningful change). */
  skipped: number;
  /**
   * Programs whose `slug` collided with a Security Target already
   * created by a different Collector, with insufficient identity
   * evidence to confirm or rule out a match — see
   * `resolveSecurityTargetWithCollisionCheck`'s doc comment. Their raw
   * payload is still captured (provenance preserved); no Event, Signal,
   * or Bug Bounty state is derived for them until the collision is
   * resolved.
   */
  collisions: ImmunefiCollisionResult[];
}

/**
 * The composition root for the Immunefi security-intelligence Collector
 * — mirrors `run-defillama.ts`'s shape exactly: one global catalog
 * covering every program Immunefi tracks, no per-company fan-out, each
 * program its own tracked entity scoped by its own Immunefi `slug` as
 * both `externalId` and `sourceIdentifier` (verified unique across all
 * 232 live programs).
 *
 * No relevance floor is applied (unlike DefiLlama's TVL floor): the
 * catalog is already small (232 programs, not ~8,500), so every program
 * is tracked.
 *
 * Deliberately does *not* run `@web3-hunter/security`'s
 * `runSecurityScoringPipeline` — ingestion and detection stay separate,
 * explicitly-triggered steps, the same discipline every other Collector
 * in this system follows.
 */
export async function runImmunefiCollector(): Promise<RunImmunefiCollectorResult> {
  const collectorId = await resolveOrCreateCollector(getDb(), "immunefi", "security-intelligence");

  try {
    const bounties = await immunefi.fetchImmunefiBounties();

    const securityTargetIdBySlug = new Map<string, string>();
    const collisions: ImmunefiCollisionResult[] = [];

    for (const batch of chunk(bounties, RESOLVE_CONCURRENCY)) {
      const resolved: {
        slug: string;
        securityTargetId: string | null;
        collisionMessage: string | null;
      }[] = await Promise.all(
        batch.map(async (bounty) => {
          const outcome = await resolveWithIdentityRepair(collectorId, {
            slug: bounty.slug,
            project: bounty.project,
            githubUrl: bounty.githubUrl ?? null,
          });
          return { slug: bounty.slug, ...outcome };
        }),
      );

      for (const outcome of resolved) {
        if (outcome.securityTargetId) {
          securityTargetIdBySlug.set(outcome.slug, outcome.securityTargetId);
        } else if (outcome.collisionMessage) {
          collisions.push({ slug: outcome.slug, message: outcome.collisionMessage });
        }
      }
    }

    // One batched write for the whole poll, not one per program — see
    // `storeRawRecords`'s doc comment. Every program's raw payload is
    // captured regardless of collision status: provenance is preserved
    // even for a program we can't yet confidently attribute to a
    // Security Target.
    await storeRawRecords(
      bounties.map((bounty) => ({
        collectorId,
        payload: bounty,
        externalId: bounty.slug,
        sourceIdentifier: bounty.slug,
      })),
    );

    let published = 0;
    let skipped = 0;

    for (const bounty of bounties) {
      const securityTargetId = securityTargetIdBySlug.get(bounty.slug);
      if (!securityTargetId) {
        continue;
      }

      const pipelineResult = await runIngestionPipeline({
        collectorId,
        sourceIdentifier: bounty.slug,
        normalize: immunefi.createImmunefiBountyProgramNormalizer(securityTargetId),
      });

      published += pipelineResult.published;
      skipped += pipelineResult.skipped;

      await upsertBugBounty({
        securityTargetId,
        platform: "immunefi",
        status: bounty.isPaused ? "paused" : "active",
        maxRewardAmount: String(bounty.maxBounty),
        scopeUrl: immunefiProgramUrl(bounty.slug),
        sourceUrl: immunefiProgramUrl(bounty.slug),
      });
    }

    await recordRunSuccess(collectorId, {
      recordsProcessed: bounties.length,
      recordsPublished: published,
    });

    return { fetched: bounties.length, published, skipped, collisions };
  } catch (error) {
    await recordRunFailure(collectorId, error instanceof Error ? error.message : String(error));
    throw error;
  }
}

/** Records a successful Collector Health snapshot — mirrors `run-defillama.ts`'s `recordRunSuccess`. */
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

/** Records a failed run, incrementing `consecutiveFailures` — mirrors `run-defillama.ts`'s `recordRunFailure`. */
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
