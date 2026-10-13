import { securityDisclosure } from "@web3-hunter/collectors";
import { getDb, resolveOrCreateCollector, schema } from "@web3-hunter/db";
import { runIngestionPipeline, storeRawRecord } from "@web3-hunter/ingestion";
import { eq } from "drizzle-orm";

/** How many targets' disclosure checks run concurrently within one batch — mirrors `run-immunefi.ts`'s `RESOLVE_CONCURRENCY`, bounding total concurrent outbound requests rather than firing all of them at once. */
const CHECK_CONCURRENCY = 10;

function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

export interface SecurityDisclosureCollectorTarget {
  securityTargetId: string;
  websiteUrl: string | null;
  repositoryUrl: string | null;
}

export interface SecurityDisclosureCheckOutcome {
  securityTargetId: string;
  routeType: "security-txt" | "github-security-policy";
  status: "published" | "skipped" | "error";
  message?: string;
}

export interface RunSecurityDisclosureCollectorResult {
  /** Targets with neither a websiteUrl nor a GitHub repositoryUrl — nothing to check, not an error. */
  skippedNoCandidateRoute: number;
  checks: SecurityDisclosureCheckOutcome[];
}

/**
 * The composition root for the Security Disclosure Collector — per-target
 * fan-out, mirrors `run-github.ts`'s shape (no "closed" reconciliation,
 * each target's own two independent checks). Checks at most two
 * well-known, standard, publicly-intended locations per target
 * (`/.well-known/security.txt` and GitHub's own Community Profile API) —
 * never a crawl, never a guess at other paths. A single target's fetch
 * failure (timeout, DNS failure, rate limit, malformed response) is
 * caught and recorded per-check; it never aborts the run for every other
 * target, per this Collector's resilience requirement.
 *
 * Deliberately does *not* run `@web3-hunter/security`'s
 * `runSecurityScoringPipeline` or recompute `researchRoute` — ingestion
 * and detection/read-model composition stay separate steps, the same
 * discipline every other Collector in this system follows.
 */
export async function runSecurityDisclosureCollector(
  targets: readonly SecurityDisclosureCollectorTarget[],
): Promise<RunSecurityDisclosureCollectorResult> {
  const startedAt = Date.now();
  const collectorId = await resolveOrCreateCollector(
    getDb(),
    "security-disclosure",
    "security-intelligence",
  );

  const checks: SecurityDisclosureCheckOutcome[] = [];
  let skippedNoCandidateRoute = 0;

  for (const batch of chunk(targets, CHECK_CONCURRENCY)) {
    const batchResults = await Promise.all(
      batch.map(async (target) => {
        const outcomes: SecurityDisclosureCheckOutcome[] = [];

        if (target.websiteUrl) {
          outcomes.push(await checkSecurityTxt(collectorId, target));
        }

        const repoRef = target.repositoryUrl
          ? securityDisclosure.parseGithubRepoUrl(target.repositoryUrl)
          : null;
        if (repoRef) {
          outcomes.push(await checkGithubSecurityPolicy(collectorId, target, repoRef));
        }

        return outcomes;
      }),
    );

    for (const outcomes of batchResults) {
      if (outcomes.length === 0) {
        skippedNoCandidateRoute += 1;
        continue;
      }
      checks.push(...outcomes);
    }
  }

  const errors = checks.filter((check) => check.status === "error");
  await recordRunHealth(collectorId, {
    durationMs: Date.now() - startedAt,
    recordsProcessed: checks.length,
    recordsPublished: checks.filter((check) => check.status === "published").length,
    errors: errors.map(
      (check) => `${check.securityTargetId} (${check.routeType}): ${check.message}`,
    ),
  });

  return { skippedNoCandidateRoute, checks };
}

async function checkSecurityTxt(
  collectorId: string,
  target: SecurityDisclosureCollectorTarget,
): Promise<SecurityDisclosureCheckOutcome> {
  const sourceIdentifier = `${target.securityTargetId}:security-txt`;
  try {
    const result = await securityDisclosure.fetchSecurityTxt(target.websiteUrl!);
    // `externalId` must be set for `runIngestionPipeline`'s previous-payload
    // lookup to work at all (see `findPreviousPayload`'s guard) — this
    // Collector has exactly one entity per `sourceIdentifier`, so the
    // target's own id serves as a stable, always-present externalId.
    //
    // `_trackedSecurityTargetId` is embedded in the *stored* payload (never
    // part of `SecurityTxtFetchResult`, and ignored by the normalizer) for
    // one reason: `storeRawRecord`'s cross-source-collision guard assumes
    // "two different sources never produce a byte-identical payload"
    // because every other Collector's payload already embeds its own
    // identifying data. Two distinct Security Targets can legitimately
    // share one website (e.g. two chains of the same protocol), which
    // makes their fetch results byte-identical with no identifying field
    // of their own — this restores that assumption instead of relying on
    // (and breaking) the dedup across genuinely different targets.
    await storeRawRecord({
      collectorId,
      payload: { ...result, _trackedSecurityTargetId: target.securityTargetId },
      externalId: target.securityTargetId,
      sourceIdentifier,
    });
    const pipelineResult = await runIngestionPipeline({
      collectorId,
      sourceIdentifier,
      normalize: securityDisclosure.createSecurityTxtNormalizer(target.securityTargetId),
    });
    return {
      securityTargetId: target.securityTargetId,
      routeType: "security-txt",
      status: pipelineResult.published > 0 ? "published" : "skipped",
    };
  } catch (error) {
    return {
      securityTargetId: target.securityTargetId,
      routeType: "security-txt",
      status: "error",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

async function checkGithubSecurityPolicy(
  collectorId: string,
  target: SecurityDisclosureCollectorTarget,
  repoRef: { owner: string; repo: string },
): Promise<SecurityDisclosureCheckOutcome> {
  const sourceIdentifier = `${target.securityTargetId}:github-security-policy`;
  try {
    const result = await securityDisclosure.fetchGithubSecurityPolicy(repoRef.owner, repoRef.repo);
    // See `checkSecurityTxt`'s identical comment on `_trackedSecurityTargetId`
    // — two distinct Security Targets can share one repository just as
    // easily as one website.
    await storeRawRecord({
      collectorId,
      payload: { ...result, _trackedSecurityTargetId: target.securityTargetId },
      externalId: target.securityTargetId,
      sourceIdentifier,
    });
    const pipelineResult = await runIngestionPipeline({
      collectorId,
      sourceIdentifier,
      normalize: securityDisclosure.createGithubSecurityPolicyNormalizer(target.securityTargetId),
    });
    return {
      securityTargetId: target.securityTargetId,
      routeType: "github-security-policy",
      status: pipelineResult.published > 0 ? "published" : "skipped",
    };
  } catch (error) {
    return {
      securityTargetId: target.securityTargetId,
      routeType: "github-security-policy",
      status: "error",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

interface RunHealth {
  durationMs: number;
  recordsProcessed: number;
  recordsPublished: number;
  errors: readonly string[];
}

/** Records exactly one Collector Health snapshot per full run — mirrors `run-github.ts`'s `recordRunHealth`. */
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
      lastErrorMessage: health.errors.slice(0, 20).join("; "),
      consecutiveFailures: (current?.consecutiveFailures ?? 0) + 1,
      lastRunRecordsProcessed: health.recordsProcessed,
      lastRunRecordsPublished: health.recordsPublished,
      lastRunDurationMs: health.durationMs,
    })
    .where(eq(schema.collector.id, collectorId));
}
