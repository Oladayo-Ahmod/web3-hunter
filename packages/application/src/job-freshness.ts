/**
 * Job freshness (Milestone 13 Phase 1). Buckets are computed from a
 * job's `updatedAt` — the latest known `JobPosted`/`JobUpdated` Event's
 * `occurredAt`, which every ATS normalizer sets to *the source's own*
 * last-modified timestamp (`packages/collectors/src/{greenhouse,lever,
 * ashby}/normalize.ts`), not our own fetch time.
 *
 * That source timestamp is a genuinely accurate "last touched" signal —
 * the bug this fixes was never in the data, it was in *labeling* it
 * "Posted Xd ago" without a freshness distinction, which reads as "this
 * job appeared X days ago" when a long-open, unedited requisition can
 * carry a source timestamp years old and still be a live, open posting.
 * `docs/MILESTONE_13_JOB_HUNTING_PIVOT.md` §8 has the full diagnosis.
 *
 * Deliberately NOT using `raw_record.fetchedAt` ("when we first saw
 * this") as the bucketing input: for a company just added to the
 * directory, every one of its already-long-open jobs would get a
 * `fetchedAt` of "today," making everything look artificially fresh —
 * the opposite failure mode. `updatedAt` doesn't have that problem: it's
 * independent of when Web3 Hunter started tracking the company.
 */
export const JOB_FRESHNESS_LEVELS = ["fresh", "recent", "aging", "stale"] as const;
export type JobFreshness = (typeof JOB_FRESHNESS_LEVELS)[number];

const DAY_MS = 24 * 60 * 60 * 1000;

const FRESH_MAX_DAYS = 7;
const RECENT_MAX_DAYS = 30;
const AGING_MAX_DAYS = 60;

/** Pure — the same `(updatedAt, now)` pair always buckets the same way, so this is unit-testable without a clock mock. */
export function computeJobFreshness(updatedAt: Date, now: Date): JobFreshness {
  // Clamped at 0: a source timestamp momentarily ahead of `now` (clock
  // skew between us and the ATS) is still today's job, never a negative
  // "days ago."
  const daysSinceUpdate = Math.max(0, (now.getTime() - updatedAt.getTime()) / DAY_MS);

  if (daysSinceUpdate <= FRESH_MAX_DAYS) {
    return "fresh";
  }
  if (daysSinceUpdate <= RECENT_MAX_DAYS) {
    return "recent";
  }
  if (daysSinceUpdate <= AGING_MAX_DAYS) {
    return "aging";
  }
  return "stale";
}
