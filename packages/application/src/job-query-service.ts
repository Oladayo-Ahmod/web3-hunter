import { getDb } from "@web3-hunter/db";
import { sql } from "drizzle-orm";
import { z } from "zod";
import type { JobFeedItemDTO, PaginatedResult } from "./dto";
import { computeJobFreshness, JOB_FRESHNESS_LEVELS, type JobFreshness } from "./job-freshness";

export const JOB_SORT_FIELDS = ["postedAt", "title"] as const;
export type JobSortField = (typeof JOB_SORT_FIELDS)[number];

/**
 * Validates and applies defaults to raw Job Feed query input, mirroring
 * `opportunityFeedQuerySchema`'s role: the same schema parses an API
 * route's URL search params and type-checks a Server Component's direct
 * call.
 *
 * Deliberately no `skill`/`role` filter yet (Milestone 13 Phase 2 —
 * relevance/matching): jobs have no Skill tags yet, only Opportunities do
 * (via `packages/classification`). `search` is a plain case-insensitive
 * substring match against the job title — the one filter that needs no
 * new extraction step to be honest about what it's matching.
 *
 * `freshness` (Phase 1): an exact-bucket filter. When omitted, the
 * default view excludes `stale` postings (see `buildJobFilter`) rather
 * than silently deleting them — pass `freshness=stale` or
 * `includeStale=true` to see them.
 */
export const jobFeedQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.enum(JOB_SORT_FIELDS).default("postedAt"),
  direction: z.enum(["asc", "desc"]).default("desc"),
  companyId: z.string().uuid().optional(),
  search: z.string().min(1).max(200).optional(),
  freshness: z.enum(JOB_FRESHNESS_LEVELS).optional(),
  includeStale: z.coerce.boolean().default(false),
});
export type JobFeedQuery = z.infer<typeof jobFeedQuerySchema>;

// The same canonical vocabulary `packages/collectors/src/hiring-events.ts`
// normalizes every source's own values into — re-declared as plain string
// literals here, not imported, per the same "packages/application never
// depends on packages/collectors" boundary `packages/scoring`'s
// hiring-detectors already follows (docs/ARCHITECTURE.md §3). This is
// what a JobPosted/JobUpdated Event's `metadata.employmentType`/
// `workplaceType` is guaranteed to be by construction, but reading raw
// JSONB back out doesn't give TypeScript that guarantee for free — these
// narrow a plain string into the literal union with a real runtime check,
// never an unchecked cast.
const EMPLOYMENT_TYPES = ["full-time", "part-time", "contract", "internship"] as const;
type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];
function asEmploymentType(value: string | null | undefined): EmploymentType | null {
  return value !== null &&
    value !== undefined &&
    (EMPLOYMENT_TYPES as readonly string[]).includes(value)
    ? (value as EmploymentType)
    : null;
}

const WORKPLACE_TYPES = ["remote", "hybrid", "onsite"] as const;
type WorkplaceType = (typeof WORKPLACE_TYPES)[number];
function asWorkplaceType(value: string | null | undefined): WorkplaceType | null {
  return value !== null &&
    value !== undefined &&
    (WORKPLACE_TYPES as readonly string[]).includes(value)
    ? (value as WorkplaceType)
    : null;
}

type OpenJobRow = {
  company_id: string;
  external_id: string;
  metadata: {
    title: string;
    locationName: string | null;
    departmentNames: string[];
    absoluteUrl: string;
    description?: string | null;
    employmentType?: string | null;
    workplaceType?: string | null;
  };
  // Raw SQL via `db.execute` does not run through Drizzle's column-type
  // mappers the way `.select()` from a table schema does — postgres-js
  // returns these as ISO strings here, not `Date` instances, so the type
  // says what actually comes back rather than what a table row would give.
  posted_at: string;
  updated_at: string;
  company_slug: string;
  company_name: string;
  company_careers_page_url: string | null;
  company_website_url: string | null;
};

function toJobFeedItemDTO(row: OpenJobRow, now: Date): JobFeedItemDTO {
  const updatedAt = new Date(row.updated_at);

  return {
    id: `${row.company_id}:${row.external_id}`,
    externalId: row.external_id,
    title: row.metadata.title,
    locationName: row.metadata.locationName,
    departmentNames: row.metadata.departmentNames,
    absoluteUrl: row.metadata.absoluteUrl,
    description: row.metadata.description ?? null,
    employmentType: asEmploymentType(row.metadata.employmentType),
    workplaceType: asWorkplaceType(row.metadata.workplaceType),
    company: {
      id: row.company_id,
      slug: row.company_slug,
      name: row.company_name,
      careersPageUrl: row.company_careers_page_url,
      websiteUrl: row.company_website_url,
    },
    status: "open",
    postedAt: new Date(row.posted_at).toISOString(),
    updatedAt: updatedAt.toISOString(),
    freshness: computeJobFreshness(updatedAt, now),
  };
}

/**
 * The CTE that derives currently-open job postings from the canonical
 * Event log — the read-time equivalent of replaying
 * JobPosted/JobUpdated/JobClosed per `(companyId, externalId)`:
 *
 * - `latest_state`: the most recent Posted/Updated Event per posting (its
 *   current title/location/etc, and when that state was set).
 * - `posted`: the first-ever Posted Event per posting (when it opened).
 * - `open_jobs`: `latest_state` rows with no `JobClosed` Event *after*
 *   that latest state — a posting closed and later reopened (a genuine
 *   new `JobPosted` Event, per `createHiringJobNormalizer`) is correctly
 *   open again.
 *
 * A read-time projection, not a persisted table, is the deliberate
 * choice here (see `JobFeedItemDTO`'s doc comment) — at today's event
 * volume this is inexpensive; if it stops being so, this exact query is
 * what a future materialized `job` read model would run at write time.
 */
const openJobsCte = sql`
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
  ),
  open_jobs AS (
    SELECT ls.company_id, ls.external_id, ls.metadata, ls.state_at, p.posted_at
    FROM latest_state ls
    JOIN posted p ON p.company_id = ls.company_id AND p.external_id = ls.external_id
    LEFT JOIN closures cl ON cl.company_id = ls.company_id AND cl.external_id = ls.external_id
    WHERE cl.closed_at IS NULL OR cl.closed_at < ls.state_at
  )
`;

/**
 * SQL equivalent of `computeJobFreshness`'s bucket boundaries, evaluated
 * against `oj.state_at` (the same `updatedAt` that function buckets) so
 * filtering happens before pagination, not after fetching a page. Must be
 * kept in sync with `job-freshness.ts`'s day thresholds by hand — there's
 * no single source both a JS function and a SQL fragment can read from
 * without a round-trip, and this filter needs to run in the database.
 * `job-freshness.test.ts`'s boundary cases (7/30/60 days) are the
 * contract this has to keep matching.
 */
function freshnessCondition(freshness: JobFreshness) {
  switch (freshness) {
    case "fresh":
      return sql`oj.state_at >= now() - interval '7 days'`;
    case "recent":
      return sql`oj.state_at < now() - interval '7 days' AND oj.state_at >= now() - interval '30 days'`;
    case "aging":
      return sql`oj.state_at < now() - interval '30 days' AND oj.state_at >= now() - interval '60 days'`;
    case "stale":
      return sql`oj.state_at < now() - interval '60 days'`;
  }
}

function buildJobFilter(query: JobFeedQuery) {
  // An explicit `freshness` filter always wins (including `freshness:
  // "stale"` — an explicit ask to see stale postings). Otherwise, unless
  // `includeStale` is set, the default view silently excludes `stale`
  // postings rather than presenting them as if they were current — see
  // `docs/MILESTONE_13_JOB_HUNTING_PIVOT.md` §8/Phase 1.
  const freshnessFilter = query.freshness
    ? sql`AND ${freshnessCondition(query.freshness)}`
    : query.includeStale
      ? sql``
      : sql`AND NOT (${freshnessCondition("stale")})`;

  return sql`
    ${query.companyId ? sql`AND oj.company_id = ${query.companyId}` : sql``}
    ${query.search ? sql`AND oj.metadata->>'title' ILIKE ${`%${query.search}%`}` : sql``}
    ${freshnessFilter}
  `;
}

function buildJobOrderBy(query: JobFeedQuery) {
  const direction = sql.raw(query.direction === "asc" ? "ASC" : "DESC");
  return query.sort === "title"
    ? sql`oj.metadata->>'title' ${direction}`
    : sql`oj.posted_at ${direction}`;
}

/**
 * The Job Feed read model (Milestone 12, Phase 3): a paginated, sorted,
 * filtered list of currently-open job postings across every tracked
 * Company. The job-listing counterpart to `listOpportunityFeed` — same
 * pagination/sort contract, same "one Application Layer function owns
 * this query" rule (docs/ARCHITECTURE.md §6).
 */
export async function listJobFeed(query: JobFeedQuery): Promise<PaginatedResult<JobFeedItemDTO>> {
  const db = getDb();
  const filter = buildJobFilter(query);
  // One `now` for the whole call: freshness filtering (SQL, above) and
  // freshness *labeling* (`toJobFeedItemDTO`, below) must agree on what
  // "now" means for a single response, even though they run as separate
  // queries a few milliseconds apart.
  const now = new Date();

  const countRows = await db.execute<{ count: number }>(sql`
    ${openJobsCte}
    SELECT count(*)::int AS count FROM open_jobs oj WHERE true ${filter}
  `);
  const totalCount = countRows[0]?.count ?? 0;

  const rows = await db.execute<OpenJobRow>(sql`
    ${openJobsCte}
    SELECT
      oj.company_id, oj.external_id, oj.metadata, oj.posted_at, oj.state_at AS updated_at,
      c.slug AS company_slug, c.name AS company_name,
      c.careers_page_url AS company_careers_page_url, c.website_url AS company_website_url
    FROM open_jobs oj
    JOIN company c ON c.id = oj.company_id
    WHERE true ${filter}
    ORDER BY ${buildJobOrderBy(query)}
    LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}
  `);

  return {
    items: rows.map((row) => toJobFeedItemDTO(row, now)),
    page: query.page,
    pageSize: query.pageSize,
    totalCount,
    totalPages: totalCount === 0 ? 0 : Math.ceil(totalCount / query.pageSize),
  };
}
