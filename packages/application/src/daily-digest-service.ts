import { getDb } from "@web3-hunter/db";
import { sql } from "drizzle-orm";
import type { TodayApplyJobDTO, TodayDigestDTO } from "./dto";
import { computeJobFreshness, type JobFreshness } from "./job-freshness";
import { computeJobRelevance, type JobRelevanceProfile } from "./job-relevance";
import { getViewerRelevanceProfile } from "./job-query-service";
import { listOutreachTargets } from "./outreach-query-service";

/** Bounded candidate pool scored/sorted in memory before slicing to `APPLY_LIMIT` — mirrors `job-query-service.ts`'s own `RELEVANCE_SORT_MAX_ROWS` reasoning, at a much smaller scale since this is already filtered to `priority`-tagged Companies. */
const APPLY_CANDIDATE_POOL = 150;
const APPLY_LIMIT = 20;
const DM_LIMIT = 20;
const RESEARCH_LIMIT = 10;

type ApplyCandidateRow = {
  company_id: string;
  external_id: string;
  title: string;
  location_name: string | null;
  workplace_type: "remote" | "hybrid" | "onsite" | null;
  posted_at: string;
  state_at: string;
  company_slug: string;
  company_name: string;
  company_priority: TodayApplyJobDTO["companyPriority"];
  absolute_url: string;
  description: string | null;
};

/**
 * The "Apply" candidate pool — open Jobs at `priority`-tagged Companies
 * only (Milestone 19 §2/§8's startup bias: `priority` is only ever
 * hand-set for the outreach-focused curation pass, so this excludes the
 * large pre-existing incumbents — Coinbase, Kraken, OKX, etc. — by
 * construction, not a filter that has to name them). Bounded to the most
 * recently posted `APPLY_CANDIDATE_POOL` rows; scored/sorted by the
 * caller once it knows whether there's a viewer Profile.
 */
async function fetchApplyCandidates(): Promise<ApplyCandidateRow[]> {
  const db = getDb();
  return db.execute<ApplyCandidateRow>(sql`
    WITH latest_state AS (
      SELECT DISTINCT ON (related_entity_id, metadata->>'externalId')
        related_entity_id AS company_id,
        metadata->>'externalId' AS external_id,
        metadata,
        occurred_at AS state_at
      FROM event
      WHERE type IN ('JobPosted', 'JobUpdated') AND related_entity_type = 'company'
      ORDER BY related_entity_id, metadata->>'externalId', occurred_at DESC
    ),
    posted AS (
      SELECT related_entity_id AS company_id, metadata->>'externalId' AS external_id, MIN(occurred_at) AS posted_at
      FROM event
      WHERE type = 'JobPosted' AND related_entity_type = 'company'
      GROUP BY 1, 2
    ),
    closures AS (
      SELECT related_entity_id AS company_id, metadata->>'externalId' AS external_id, MAX(occurred_at) AS closed_at
      FROM event
      WHERE type = 'JobClosed' AND related_entity_type = 'company'
      GROUP BY 1, 2
    )
    SELECT
      ls.company_id, ls.external_id,
      ls.metadata->>'title' AS title,
      ls.metadata->>'locationName' AS location_name,
      ls.metadata->>'workplaceType' AS workplace_type,
      p.posted_at, ls.state_at,
      c.slug AS company_slug, c.name AS company_name, c.priority AS company_priority,
      ls.metadata->>'absoluteUrl' AS absolute_url,
      ls.metadata->>'description' AS description
    FROM latest_state ls
    JOIN posted p ON p.company_id = ls.company_id AND p.external_id = ls.external_id
    LEFT JOIN closures cl ON cl.company_id = ls.company_id AND cl.external_id = ls.external_id
    JOIN company c ON c.id = ls.company_id
      AND c.discovery_status != 'rejected'
      AND c.priority IS NOT NULL
    WHERE cl.closed_at IS NULL OR cl.closed_at < ls.state_at
    ORDER BY ls.state_at DESC
    LIMIT ${APPLY_CANDIDATE_POOL}
  `);
}

function toApplyJobDTO(
  row: ApplyCandidateRow,
  now: Date,
  relevanceScore: number | null,
): TodayApplyJobDTO {
  return {
    id: `${row.company_id}:${row.external_id}`,
    title: row.title,
    companySlug: row.company_slug,
    companyName: row.company_name,
    companyPriority: row.company_priority,
    absoluteUrl: row.absolute_url,
    locationName: row.location_name,
    workplaceType: row.workplace_type,
    postedAt: new Date(row.posted_at).toISOString(),
    freshness: computeJobFreshness(new Date(row.state_at), now),
    relevanceScore,
  };
}

const FRESHNESS_RANK: Record<JobFreshness, number> = { fresh: 0, recent: 1, aging: 2, stale: 3 };

/**
 * Ranks and slices the Apply candidate pool. With a viewer Profile, real
 * relevance (the same `computeJobRelevance` the Job Feed itself uses)
 * dominates the sort — "strongest," per Milestone 19 §6, not just
 * "newest." Without one, freshness is the only signal available, so it
 * sorts by that instead of pretending to rank by fit.
 */
async function rankApplyJobs(viewerId: string | undefined): Promise<TodayApplyJobDTO[]> {
  const rows = await fetchApplyCandidates();
  const now = new Date();
  const viewerProfile: JobRelevanceProfile | null = viewerId
    ? await getViewerRelevanceProfile(viewerId)
    : null;

  const scored = rows.map((row) => {
    const relevance = viewerProfile
      ? computeJobRelevance(
          {
            title: row.title,
            departmentNames: [],
            workplaceType: row.workplace_type,
            locationName: row.location_name,
            description: row.description,
          },
          [],
          viewerProfile,
          new Map(),
        )
      : null;
    return { row, relevanceScore: relevance?.score ?? null };
  });

  scored.sort((a, b) => {
    if (a.relevanceScore !== null && b.relevanceScore !== null) {
      if (a.relevanceScore !== b.relevanceScore) {
        return b.relevanceScore - a.relevanceScore;
      }
    }
    const freshnessDelta =
      FRESHNESS_RANK[computeJobFreshness(new Date(a.row.state_at), now)] -
      FRESHNESS_RANK[computeJobFreshness(new Date(b.row.state_at), now)];
    if (freshnessDelta !== 0) {
      return freshnessDelta;
    }
    return new Date(b.row.state_at).getTime() - new Date(a.row.state_at).getTime();
  });

  return scored
    .slice(0, APPLY_LIMIT)
    .map(({ row, relevanceScore }) => toApplyJobDTO(row, now, relevanceScore));
}

const PRIORITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };

/**
 * The Today Digest (Milestone 19 §6) — "here are the ~20 jobs and ~20
 * companies you should attack today," built entirely from data
 * `listOutreachTargets`/the Job Feed already compute. No new scoring
 * subsystem: Apply is real-job relevance/freshness (existing
 * `job-relevance.ts`); DM/Research are `listOutreachTargets`'s own
 * `priority`/`recentlyFunded`/contact-presence facts, just re-sorted for
 * this specific "what next" question.
 */
export async function getTodayDigest(viewerId?: string): Promise<TodayDigestDTO> {
  const [applyJobs, allTargets] = await Promise.all([
    rankApplyJobs(viewerId),
    listOutreachTargets(),
  ]);

  const noOpenRole = allTargets.filter((target) => target.opportunityType !== "OPEN_ROLE");

  // DM: ranked funded-first, then priority, then "has a contact" (so the
  // first 20 are maximally actionable today, not just maximally
  // interesting) — a fixed comparator, not a score.
  const dmRanked = [...noOpenRole].sort((a, b) => {
    if (a.recentlyFunded !== b.recentlyFunded) {
      return a.recentlyFunded ? -1 : 1;
    }
    const priorityDelta =
      (PRIORITY_RANK[a.priority ?? ""] ?? 3) - (PRIORITY_RANK[b.priority ?? ""] ?? 3);
    if (priorityDelta !== 0) {
      return priorityDelta;
    }
    const aHasContact = a.contacts.length > 0;
    const bHasContact = b.contacts.length > 0;
    if (aHasContact !== bHasContact) {
      return aHasContact ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });

  const dmTargets = dmRanked.slice(0, DM_LIMIT);
  const dmIds = new Set(dmTargets.map((target) => target.id));

  // Research: the next tier down — genuinely "worth investigating," so
  // deliberately the ones DM skipped for having no contact yet, not a
  // second copy of the same top targets.
  const researchTargets = noOpenRole
    .filter((target) => !dmIds.has(target.id) && target.contacts.length === 0)
    .slice(0, RESEARCH_LIMIT);

  return { applyJobs, dmTargets, researchTargets };
}
