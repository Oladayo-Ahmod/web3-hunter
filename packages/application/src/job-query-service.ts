import { getDb } from "@web3-hunter/db";
import { sql } from "drizzle-orm";
import { z } from "zod";
import type { JobFeedItemDTO, PaginatedResult } from "./dto";

export const JOB_SORT_FIELDS = ["postedAt", "title"] as const;
export type JobSortField = (typeof JOB_SORT_FIELDS)[number];

/**
 * Validates and applies defaults to raw Job Feed query input, mirroring
 * `opportunityFeedQuerySchema`'s role: the same schema parses an API
 * route's URL search params and type-checks a Server Component's direct
 * call.
 *
 * Deliberately no `remote`/`seniority`/`skill` filters yet (Milestone 12
 * Phase 4): none of that data is captured by any Collector today
 * (`JobFields` has no `workplaceType`/`seniority`, and jobs have no Skill
 * tags — only Opportunities do, via `packages/classification`). `search`
 * is a plain case-insensitive substring match against the job title —
 * the one filter that needs no new extraction step to be honest about
 * what it's matching.
 */
export const jobFeedQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.enum(JOB_SORT_FIELDS).default("postedAt"),
  direction: z.enum(["asc", "desc"]).default("desc"),
  companyId: z.string().uuid().optional(),
  search: z.string().min(1).max(200).optional(),
});
export type JobFeedQuery = z.infer<typeof jobFeedQuerySchema>;

type OpenJobRow = {
  company_id: string;
  external_id: string;
  metadata: {
    title: string;
    locationName: string | null;
    departmentNames: string[];
    absoluteUrl: string;
  };
  // Raw SQL via `db.execute` does not run through Drizzle's column-type
  // mappers the way `.select()` from a table schema does — postgres-js
  // returns these as ISO strings here, not `Date` instances, so the type
  // says what actually comes back rather than what a table row would give.
  posted_at: string;
  updated_at: string;
  company_slug: string;
  company_name: string;
};

function toJobFeedItemDTO(row: OpenJobRow): JobFeedItemDTO {
  return {
    id: `${row.company_id}:${row.external_id}`,
    externalId: row.external_id,
    title: row.metadata.title,
    locationName: row.metadata.locationName,
    departmentNames: row.metadata.departmentNames,
    absoluteUrl: row.metadata.absoluteUrl,
    company: { id: row.company_id, slug: row.company_slug, name: row.company_name },
    postedAt: new Date(row.posted_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
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

function buildJobFilter(query: JobFeedQuery) {
  return sql`
    ${query.companyId ? sql`AND oj.company_id = ${query.companyId}` : sql``}
    ${query.search ? sql`AND oj.metadata->>'title' ILIKE ${`%${query.search}%`}` : sql``}
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

  const countRows = await db.execute<{ count: number }>(sql`
    ${openJobsCte}
    SELECT count(*)::int AS count FROM open_jobs oj WHERE true ${filter}
  `);
  const totalCount = countRows[0]?.count ?? 0;

  const rows = await db.execute<OpenJobRow>(sql`
    ${openJobsCte}
    SELECT
      oj.company_id, oj.external_id, oj.metadata, oj.posted_at, oj.state_at AS updated_at,
      c.slug AS company_slug, c.name AS company_name
    FROM open_jobs oj
    JOIN company c ON c.id = oj.company_id
    WHERE true ${filter}
    ORDER BY ${buildJobOrderBy(query)}
    LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}
  `);

  return {
    items: rows.map(toJobFeedItemDTO),
    page: query.page,
    pageSize: query.pageSize,
    totalCount,
    totalPages: totalCount === 0 ? 0 : Math.ceil(totalCount / query.pageSize),
  };
}
