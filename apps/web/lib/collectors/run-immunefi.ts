import { immunefi } from "@web3-hunter/collectors";
import { getDb, resolveOrCreateCollector, schema } from "@web3-hunter/db";
import { runIngestionPipeline, storeRawRecords } from "@web3-hunter/ingestion";
import {
  SecurityTargetIdentityCollisionError,
  resolveSecurityTargetWithCollisionCheck,
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
          try {
            const securityTargetId = await resolveSecurityTargetWithCollisionCheck(
              collectorId,
              bounty.slug,
              {
                slug: bounty.slug,
                name: bounty.project,
                repositoryUrl: bounty.githubUrl ?? null,
                discoverySource: "immunefi-bounties",
                discoveredAt: new Date(),
              },
            );
            return { slug: bounty.slug, securityTargetId, collisionMessage: null };
          } catch (error) {
            if (error instanceof SecurityTargetIdentityCollisionError) {
              return { slug: bounty.slug, securityTargetId: null, collisionMessage: error.message };
            }
            throw error;
          }
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
