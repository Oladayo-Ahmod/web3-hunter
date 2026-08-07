import { github } from "@web3-hunter/collectors";
import { getDb, resolveOrCreateCollector, schema } from "@web3-hunter/db";
import { runIngestionPipeline, storeRawRecord } from "@web3-hunter/ingestion";
import { and, eq } from "drizzle-orm";

export interface TrackedGithubOrg {
  /** Our own canonical, cross-source identifier for this company (see docs/DATABASE.md §9). */
  companySlug: string;
  companyName: string;
  /** The GitHub organization's login, e.g. the "acme" in `github.com/acme`. */
  org: string;
}

export type RunGithubCollectorResult =
  | {
      companySlug: string;
      status: "ok";
      fetched: number;
      /** RepositoryDiscovered + RepositoryUpdated events published. */
      published: number;
      /** Raw Records that produced no event (no meaningful change). */
      skipped: number;
    }
  | { companySlug: string; status: "error"; message: string };

/**
 * The composition root for the GitHub Collector — deliberately its own,
 * not built on `./run-collector.ts`'s `CollectorSourceConfig<TRecord>`,
 * per the approved Milestone 9 Definition of Ready: "the generic ATS
 * orchestration introduced in Milestone 8 should not be stretched to fit
 * a fundamentally different data source." A GitHub org has no "closed"
 * reconciliation the way a job posting does (a repository disappearing
 * from an org's listing is out of scope — see docs/ROADMAP.md), so this
 * is simpler than `run-collector.ts`, built directly on
 * `packages/ingestion`'s already source-agnostic primitives.
 *
 * Still reuses `company_source_identity` exactly as `run-collector.ts`
 * does: a GitHub org login is just another Collector-scoped
 * `sourceIdentifier` resolving to the same Company a Greenhouse board
 * token or Lever site slug might already point at. Still records
 * Collector Health the same way, once per full run — so `GET
 * /api/collectors` reports on this Collector identically to every ATS
 * one, per Milestone 8's platform-wide Collector Health feature.
 *
 * Deliberately does *not* trigger `packages/technology`'s
 * `runTechnologyPipeline` — ingestion and detection stay separate,
 * explicitly-triggered steps, the same discipline every other Collector
 * in this system follows (see `apps/web/scripts/run-technology.ts`).
 */
export async function runGithubCollector(
  orgs: readonly TrackedGithubOrg[],
): Promise<RunGithubCollectorResult[]> {
  const startedAt = Date.now();
  const collectorId = await resolveOrCreateCollector(getDb(), "github", "vcs");
  const results: RunGithubCollectorResult[] = [];
  const errors: string[] = [];
  let recordsProcessed = 0;
  let recordsPublished = 0;

  for (const trackedOrg of orgs) {
    try {
      const result = await runForOrg(collectorId, trackedOrg);
      results.push(result);
      recordsProcessed += result.fetched;
      recordsPublished += result.published;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${trackedOrg.companySlug}: ${message}`);
      results.push({ companySlug: trackedOrg.companySlug, status: "error", message });
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

async function runForOrg(
  collectorId: string,
  trackedOrg: TrackedGithubOrg,
): Promise<Extract<RunGithubCollectorResult, { status: "ok" }>> {
  const companyId = await resolveCompany(collectorId, trackedOrg);
  const repos = await github.fetchGithubOrgRepos(trackedOrg.org);

  for (const repo of repos) {
    await storeRawRecord({ collectorId, payload: repo, externalId: String(repo.id) });
  }

  const pipelineResult = await runIngestionPipeline({
    collectorId,
    normalize: github.createGithubRepositoryNormalizer(companyId),
  });

  return {
    companySlug: trackedOrg.companySlug,
    status: "ok",
    fetched: repos.length,
    published: pipelineResult.published,
    skipped: pipelineResult.skipped,
  };
}

/**
 * Resolves a tracked org's Company row through the same explicit
 * `company_source_identity` mapping `run-collector.ts` uses — see that
 * table's doc comment. A GitHub org login is this Collector's own
 * `sourceIdentifier`.
 */
async function resolveCompany(collectorId: string, trackedOrg: TrackedGithubOrg): Promise<string> {
  const db = getDb();

  const [existingIdentity] = await db
    .select()
    .from(schema.companySourceIdentity)
    .where(
      and(
        eq(schema.companySourceIdentity.collectorId, collectorId),
        eq(schema.companySourceIdentity.sourceIdentifier, trackedOrg.org),
      ),
    )
    .limit(1);

  if (existingIdentity) {
    return existingIdentity.companyId;
  }

  const companyId = await resolveCompanyBySlug(trackedOrg.companySlug, trackedOrg.companyName);

  await db
    .insert(schema.companySourceIdentity)
    .values({ collectorId, sourceIdentifier: trackedOrg.org, companyId })
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

/** Records exactly one Collector Health snapshot per full run — see `run-collector.ts`'s equivalent for the run-level (not per-org) health definition this mirrors. */
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
