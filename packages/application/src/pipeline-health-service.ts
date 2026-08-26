import { getDb, schema } from "@web3-hunter/db";
import { desc, inArray } from "drizzle-orm";
import { listCollectorHealth } from "./collector-query-service";
import type { CollectorHealthWithFreshnessDTO, PipelineHealthDTO } from "./dto";

/**
 * How stale a Collector's `lastRunAt` may be before it's flagged, keyed by
 * `collector.slug`. Job Collectors run every 6h (job-ingestion.yml) —
 * double that plus slack tolerates one missed run without false-alarming.
 * `github` runs once daily (enrichment.yml) — same "double the cadence"
 * rule. Any Collector not listed here (a future addition) falls back to
 * `DEFAULT_STALENESS_THRESHOLD_HOURS`, a conservative default rather than
 * silently never flagging it as stale.
 *
 * Milestone 24, governing directive Part 8 — "the system must not
 * silently become stale." Thresholds are a deliberate, documented
 * decision tied to the actual schedules in `.github/workflows/`, not
 * arbitrary numbers — keep the two in sync if either schedule changes.
 */
const STALENESS_THRESHOLD_HOURS: Partial<Record<string, number>> = {
  greenhouse: 14,
  lever: 14,
  ashby: 14,
  github: 30,
};
const DEFAULT_STALENESS_THRESHOLD_HOURS = 14;

/** Same reasoning as `STALENESS_THRESHOLD_HOURS.greenhouse` et al., applied to the aggregate `jobsLastRefreshedAt` signal. */
const JOBS_STALENESS_THRESHOLD_HOURS = 14;

function isStale(lastRunAtIso: string | null, thresholdHours: number): boolean {
  if (!lastRunAtIso) {
    return true;
  }
  return Date.now() - new Date(lastRunAtIso).getTime() > thresholdHours * 60 * 60 * 1000;
}

/**
 * Data freshness as a first-class, queryable fact (Milestone 24, governing
 * directive Part 8) — built entirely from data the system already
 * maintains (`listCollectorHealth`'s Milestone 8 Collector Health, and
 * `event`'s own timestamps), no new table. Intended for `/api/health` so
 * staleness is visible via a request rather than discovered by a user
 * noticing old postings.
 *
 * `jobsLastRefreshedAt` deliberately reads the `event` table directly
 * rather than trusting `collector.lastRunAt` alone: `recordRunHealth`
 * only advances `lastRunAt` when *every* tracked Company in a run
 * succeeds (see `run-collector.ts`), so one flaky company could hold
 * `lastRunAt` back indefinitely even while the other 499 published fresh
 * JobPosted/JobUpdated Events. Reading the Events directly answers the
 * question a user actually cares about — "is the job data fresh" — not
 * "did every single company succeed on the same run."
 */
export async function getPipelineHealth(): Promise<PipelineHealthDTO> {
  const db = getDb();

  const [collectorRows, [latestJobEvent]] = await Promise.all([
    listCollectorHealth(),
    db
      .select({ occurredAt: schema.event.occurredAt })
      .from(schema.event)
      .where(inArray(schema.event.type, ["JobPosted", "JobUpdated"]))
      .orderBy(desc(schema.event.occurredAt))
      .limit(1),
  ]);

  const jobsLastRefreshedAt = latestJobEvent?.occurredAt.toISOString() ?? null;

  const collectors: CollectorHealthWithFreshnessDTO[] = collectorRows.map((row) => ({
    ...row,
    isStale: isStale(
      row.lastRunAt,
      STALENESS_THRESHOLD_HOURS[row.slug] ?? DEFAULT_STALENESS_THRESHOLD_HOURS,
    ),
  }));

  return {
    jobsLastRefreshedAt,
    jobsAreStale: isStale(jobsLastRefreshedAt, JOBS_STALENESS_THRESHOLD_HOURS),
    collectors,
  };
}
