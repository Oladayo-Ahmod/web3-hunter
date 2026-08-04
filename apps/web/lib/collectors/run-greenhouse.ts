import { greenhouse } from "@web3-hunter/collectors";
import { getDb, schema } from "@web3-hunter/db";
import {
  reconcileMissingRecords,
  runIngestionPipeline,
  storeRawRecord,
} from "@web3-hunter/ingestion";
import { eq } from "drizzle-orm";

export interface TrackedCompany {
  /** Our own stable identifier for this company (see docs/DATABASE.md §9 — single-source only for now). */
  slug: string;
  name: string;
  /** The company's Greenhouse Job Board token, e.g. the `acme` in `boards.greenhouse.io/acme`. */
  boardToken: string;
}

export type RunGreenhouseCollectorResult =
  | {
      companySlug: string;
      status: "ok";
      fetched: number;
      /** JobPosted + JobUpdated events published. */
      published: number;
      /** Raw Records that produced no event (no meaningful change). */
      skipped: number;
      /** JobClosed events published for roles no longer present. */
      closed: number;
    }
  | { companySlug: string; status: "error"; message: string };

/**
 * The composition root for the Greenhouse Collector: resolves the shared
 * `collector` and per-company `company` rows (the one piece of direct
 * database access this orchestration needs, which is why it lives in
 * `apps/web` rather than `packages/collectors` — see
 * docs/ARCHITECTURE.md §9, "Collectors never persist or publish
 * directly"), fetches each tracked company's board, hands every job to
 * `packages/ingestion` as a Raw Record, then runs the ingestion pipeline
 * and reconciliation using the pure normalizers `packages/collectors`
 * supplies. Deliberately framework-agnostic: nothing here imports Next.js,
 * so it runs identically from a script, a cron-triggered route, or a test.
 *
 * A single company's failure never aborts the run for the others — it's
 * recorded and the loop continues, per docs/ROADMAP.md Milestone 2's
 * acceptance criteria.
 */
export async function runGreenhouseCollector(
  companies: readonly TrackedCompany[],
): Promise<RunGreenhouseCollectorResult[]> {
  const collectorId = await resolveCollector();
  const results: RunGreenhouseCollectorResult[] = [];

  for (const trackedCompany of companies) {
    try {
      results.push(await runForCompany(collectorId, trackedCompany));
      await markCollectorRunSucceeded(collectorId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await markCollectorRunFailed(collectorId, message);
      results.push({ companySlug: trackedCompany.slug, status: "error", message });
    }
  }

  return results;
}

async function runForCompany(
  collectorId: string,
  trackedCompany: TrackedCompany,
): Promise<RunGreenhouseCollectorResult> {
  const companyId = await resolveCompany(trackedCompany.slug, trackedCompany.name);
  const jobs = await greenhouse.fetchGreenhouseJobs(trackedCompany.boardToken);

  for (const job of jobs) {
    await storeRawRecord({ collectorId, payload: job, externalId: String(job.id) });
  }

  const pipelineResult = await runIngestionPipeline({
    collectorId,
    normalize: greenhouse.createGreenhouseJobNormalizer(companyId),
  });

  const closedResult = await reconcileMissingRecords({
    collectorId,
    currentExternalIds: jobs.map((job) => String(job.id)),
    normalizeMissing: greenhouse.createGreenhouseJobClosedNormalizer(companyId),
  });

  return {
    companySlug: trackedCompany.slug,
    status: "ok",
    fetched: jobs.length,
    published: pipelineResult.published,
    skipped: pipelineResult.skipped,
    closed: closedResult.published,
  };
}

async function resolveCollector(): Promise<string> {
  const db = getDb();

  const [created] = await db
    .insert(schema.collector)
    .values({ slug: "greenhouse", sourceType: "ats" })
    .onConflictDoNothing({ target: schema.collector.slug })
    .returning();

  if (created) {
    return created.id;
  }

  const [existing] = await db
    .select()
    .from(schema.collector)
    .where(eq(schema.collector.slug, "greenhouse"))
    .limit(1);

  if (!existing) {
    throw new Error('Failed to resolve the "greenhouse" collector row.');
  }

  return existing.id;
}

async function resolveCompany(slug: string, name: string): Promise<string> {
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

async function markCollectorRunSucceeded(collectorId: string): Promise<void> {
  await getDb()
    .update(schema.collector)
    .set({ status: "active", lastRunAt: new Date() })
    .where(eq(schema.collector.id, collectorId));
}

async function markCollectorRunFailed(collectorId: string, message: string): Promise<void> {
  await getDb()
    .update(schema.collector)
    .set({ status: "degraded", lastErrorAt: new Date(), lastErrorMessage: message })
    .where(eq(schema.collector.id, collectorId));
}
