import { getDb, schema } from "@web3-hunter/db";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { JobFeedItemDTO, PaginatedResult, SkillDTO } from "./dto";
import { computeJobFreshness, JOB_FRESHNESS_LEVELS, type JobFreshness } from "./job-freshness";
import {
  computeJobRelevance,
  TARGET_ROLES,
  type JobRelevanceProfile,
  type JobRelevanceResult,
} from "./job-relevance";
import { toSkillDTO } from "./mappers";

export const JOB_SORT_FIELDS = ["postedAt", "title", "relevance"] as const;
export type JobSortField = (typeof JOB_SORT_FIELDS)[number];

/**
 * Validates and applies defaults to raw Job Feed query input, mirroring
 * `opportunityFeedQuerySchema`'s role: the same schema parses an API
 * route's URL search params and type-checks a Server Component's direct
 * call.
 *
 * `search` is a plain case-insensitive substring match against the job
 * title. `role` filters by one `TARGET_ROLES` slug's title keywords
 * (Milestone 13 Phase 2) — a coarser, deterministic pre-filter, distinct
 * from the per-viewer relevance *score*, which additionally needs a real
 * User Profile to compute. `minMatch` only has an effect when `sort:
 * "relevance"` and a `viewerId` with a Profile were supplied to
 * `listJobFeed` — see that function's doc comment for why it can't be
 * honored otherwise.
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
  workplaceType: z.enum(["remote", "hybrid", "onsite"]).optional(),
  role: z.string().min(1).optional(),
  minMatch: z.coerce.number().int().min(0).max(100).optional(),
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

/**
 * Everything about the viewing User needed to score a Job — resolved
 * once per `listJobFeed` call, not once per Job. `null` when there's no
 * viewer, or the viewer hasn't created a Profile yet (same "may start
 * minimal" state `packages/matching`'s `getUserProfile` already treats
 * as absent, not empty).
 */
async function getViewerRelevanceProfile(viewerId: string): Promise<JobRelevanceProfile | null> {
  const db = getDb();

  const [profileRow] = await db
    .select()
    .from(schema.userProfile)
    .where(eq(schema.userProfile.userId, viewerId))
    .limit(1);
  if (!profileRow) {
    return null;
  }

  const skillRows = await db
    .select({ skillId: schema.userSkill.skillId })
    .from(schema.userSkill)
    .where(eq(schema.userSkill.userId, viewerId));

  return {
    skillIds: skillRows.map((row) => row.skillId),
    targetRoleSlugs: profileRow.targetRoleSlugs,
    remotePreference: profileRow.remotePreference,
    seniorityPreference: profileRow.seniorityPreference,
  };
}

/**
 * Batch-fetches `job_skill` for every `(companyId, externalId)` pair
 * among the given rows in one query — filtered by `company_id = ANY(…)`
 * (indexed), not a tuple-IN, then grouped client-side, the same
 * "one query, not N" discipline `resolveSkillsById` follows for Matches.
 * Harmless over-fetch (a company's *other* Jobs' skills come along for
 * the ride) is discarded when grouping, not queried around, since the
 * set of distinct companies on one page is almost always small.
 */
async function fetchJobSkillsByCompanyExternalId(
  rows: readonly Pick<OpenJobRow, "company_id" | "external_id">[],
): Promise<Map<string, string[]>> {
  const companyIds = [...new Set(rows.map((row) => row.company_id))];
  if (companyIds.length === 0) {
    return new Map();
  }

  const skillRows = await getDb().execute<{
    company_id: string;
    external_id: string;
    skill_id: string;
  }>(sql`
    SELECT company_id, external_id, skill_id FROM job_skill WHERE company_id = ANY(${companyIds})
  `);

  const wanted = new Set(rows.map((row) => `${row.company_id}:${row.external_id}`));
  const bySkillKey = new Map<string, string[]>();
  for (const row of skillRows) {
    const key = `${row.company_id}:${row.external_id}`;
    if (!wanted.has(key)) {
      continue;
    }
    const existing = bySkillKey.get(key) ?? [];
    existing.push(row.skill_id);
    bySkillKey.set(key, existing);
  }
  return bySkillKey;
}

async function resolveSkillNamesById(skillIds: readonly string[]): Promise<Map<string, SkillDTO>> {
  const uniqueIds = [...new Set(skillIds)];
  if (uniqueIds.length === 0) {
    return new Map();
  }
  const rows = await getDb()
    .select()
    .from(schema.skill)
    .where(sql`${schema.skill.id} = ANY(${uniqueIds})`);
  return new Map(rows.map((row) => [row.id, toSkillDTO(row)]));
}

function toJobFeedItemDTO(
  row: OpenJobRow,
  now: Date,
  detectedSkillIds: readonly string[],
  skillById: ReadonlyMap<string, SkillDTO>,
  relevance: JobRelevanceResult | null,
): JobFeedItemDTO {
  const updatedAt = new Date(row.updated_at);

  const resolveSkills = (ids: readonly string[]): SkillDTO[] =>
    ids.map((id) => skillById.get(id)).filter((skill): skill is SkillDTO => skill !== undefined);

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
    detectedSkills: resolveSkills(detectedSkillIds),
    relevance: relevance
      ? {
          score: relevance.score,
          tier: relevance.tier,
          breakdown: relevance.breakdown,
          matchedSkills: resolveSkills(relevance.matchedSkillIds),
        }
      : null,
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

  const roleKeywords = query.role ? (TARGET_ROLES[query.role]?.titleKeywords ?? []) : [];
  const roleFilter =
    roleKeywords.length > 0
      ? sql`AND (${sql.join(
          roleKeywords.map((keyword) => sql`oj.metadata->>'title' ILIKE ${`%${keyword}%`}`),
          sql` OR `,
        )})`
      : sql``;

  return sql`
    ${query.companyId ? sql`AND oj.company_id = ${query.companyId}` : sql``}
    ${query.search ? sql`AND oj.metadata->>'title' ILIKE ${`%${query.search}%`}` : sql``}
    ${query.workplaceType ? sql`AND oj.metadata->>'workplaceType' = ${query.workplaceType}` : sql``}
    ${roleFilter}
    ${freshnessFilter}
  `;
}

function buildJobOrderBy(query: JobFeedQuery) {
  const direction = sql.raw(query.direction === "asc" ? "ASC" : "DESC");
  return query.sort === "title"
    ? sql`oj.metadata->>'title' ${direction}`
    : sql`oj.posted_at ${direction}`;
}

/** Upper bound on how many open Jobs `listJobFeed` will pull into memory to sort by relevance — see that function's doc comment. Comfortably above real volume today (hundreds); revisit if it stops being so. */
const RELEVANCE_SORT_MAX_ROWS = 5000;

/**
 * The Job Feed read model. The job-listing counterpart to
 * `listOpportunityFeed` — same pagination/sort contract, same "one
 * Application Layer function owns this query" rule
 * (docs/ARCHITECTURE.md §6).
 *
 * `viewerId` (Milestone 13 Phase 2, mirrors `listOpportunityFeed`'s own
 * parameter): when supplied and that User has a Profile, every returned
 * Job carries a `relevance` score/breakdown against it. `sort:
 * "relevance"` additionally *orders* by that score — which, unlike every
 * other sort here, cannot be pushed into the SQL `ORDER BY`/`LIMIT`
 * (the scorer is a TypeScript function of per-viewer data, not a SQL
 * expression). So this one mode fetches every currently-matching open
 * Job (bounded by `RELEVANCE_SORT_MAX_ROWS`), scores each in memory,
 * sorts, and paginates the resulting array — cheap at today's volume
 * (hundreds of Jobs); if that stops being true, this is exactly the
 * computation a persisted `job_match` table (deferred in the Milestone 13
 * design doc, §3) would take over. Every other sort/no-viewer path is
 * unchanged from Milestone 12/13-Phase-1: SQL-paginated, viewer-agnostic
 * volume.
 *
 * `minMatch` only filters in the `sort: "relevance"` + viewer-with-
 * Profile case, for the same reason — there is no score to filter by
 * otherwise. It is silently ignored, not an error, outside that case:
 * mirrors `listOpportunityFeed`'s own "relevance falls back to score
 * without a viewer" fallback rather than erroring.
 */
export async function listJobFeed(
  query: JobFeedQuery,
  viewerId?: string,
): Promise<PaginatedResult<JobFeedItemDTO>> {
  const db = getDb();
  const filter = buildJobFilter(query);
  // One `now` for the whole call: freshness filtering (SQL) and
  // freshness *labeling* (`toJobFeedItemDTO`) must agree on what "now"
  // means for a single response, even though they run as separate
  // queries a few milliseconds apart.
  const now = new Date();

  const viewerProfile = viewerId ? await getViewerRelevanceProfile(viewerId) : null;

  if (query.sort === "relevance" && viewerProfile) {
    const rows = await db.execute<OpenJobRow>(sql`
      ${openJobsCte}
      SELECT
        oj.company_id, oj.external_id, oj.metadata, oj.posted_at, oj.state_at AS updated_at,
        c.slug AS company_slug, c.name AS company_name,
        c.careers_page_url AS company_careers_page_url, c.website_url AS company_website_url
      FROM open_jobs oj
      JOIN company c ON c.id = oj.company_id
      WHERE true ${filter}
      ORDER BY oj.posted_at DESC
      LIMIT ${RELEVANCE_SORT_MAX_ROWS}
    `);

    // Skill *names* are only needed for the final page after
    // scoring/sorting/pagination (below) — scoring itself only needs IDs.
    const skillsByJob = await fetchJobSkillsByCompanyExternalId(rows);

    const scored = rows.map((row) => {
      const detectedSkillIds = skillsByJob.get(`${row.company_id}:${row.external_id}`) ?? [];
      const relevance = computeJobRelevance(
        {
          title: row.metadata.title,
          departmentNames: row.metadata.departmentNames,
          workplaceType: asWorkplaceType(row.metadata.workplaceType),
        },
        detectedSkillIds,
        viewerProfile,
        new Map(), // names resolved once, below, after we know the final page
      );
      return { row, detectedSkillIds, relevance };
    });

    const filtered =
      query.minMatch !== undefined
        ? scored.filter((entry) => entry.relevance.score >= query.minMatch!)
        : scored;

    const direction = query.direction === "asc" ? 1 : -1;
    filtered.sort((a, b) => direction * (a.relevance.score - b.relevance.score));

    const totalCount = filtered.length;
    const start = (query.page - 1) * query.pageSize;
    const page = filtered.slice(start, start + query.pageSize);

    const allSkillIds = page.flatMap((entry) => [
      ...entry.detectedSkillIds,
      ...entry.relevance.matchedSkillIds,
    ]);
    const resolvedSkillById = await resolveSkillNamesById(allSkillIds);

    return {
      items: page.map((entry) =>
        toJobFeedItemDTO(
          entry.row,
          now,
          entry.detectedSkillIds,
          resolvedSkillById,
          entry.relevance,
        ),
      ),
      page: query.page,
      pageSize: query.pageSize,
      totalCount,
      totalPages: totalCount === 0 ? 0 : Math.ceil(totalCount / query.pageSize),
    };
  }

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

  // Even outside `sort: "relevance"`, a viewer with a Profile still sees
  // per-Job relevance on each card (Milestone 13 Phase 2's "show the
  // match directly in the feed") — just not used to order/filter this
  // page. Bounded to this page's rows (≤ `pageSize`), so this is cheap
  // regardless of sort mode.
  const skillsByJob = await fetchJobSkillsByCompanyExternalId(rows);
  const scoredRows = rows.map((row) => {
    const detectedSkillIds = skillsByJob.get(`${row.company_id}:${row.external_id}`) ?? [];
    const relevance = viewerProfile
      ? computeJobRelevance(
          {
            title: row.metadata.title,
            departmentNames: row.metadata.departmentNames,
            workplaceType: asWorkplaceType(row.metadata.workplaceType),
          },
          detectedSkillIds,
          viewerProfile,
          new Map(),
        )
      : null;
    return { row, detectedSkillIds, relevance };
  });

  const allSkillIds = scoredRows.flatMap((entry) => [
    ...entry.detectedSkillIds,
    ...(entry.relevance?.matchedSkillIds ?? []),
  ]);
  const skillById = await resolveSkillNamesById(allSkillIds);

  return {
    items: scoredRows.map((entry) =>
      toJobFeedItemDTO(entry.row, now, entry.detectedSkillIds, skillById, entry.relevance),
    ),
    page: query.page,
    pageSize: query.pageSize,
    totalCount,
    totalPages: totalCount === 0 ? 0 : Math.ceil(totalCount / query.pageSize),
  };
}

/**
 * A single open Job by its `JobFeedItemDTO.id` (`${companyId}:${externalId}`,
 * see that DTO's doc comment) — the Job Detail read model for
 * `/jobs/[id]` (Milestone 13 Phase 2). Returns `null` for an unknown or
 * no-longer-open id, the same "not found is an expected outcome, not an
 * error" convention `getOpportunityDetail` uses.
 */
export async function getJobDetail(id: string, viewerId?: string): Promise<JobFeedItemDTO | null> {
  const separatorIndex = id.indexOf(":");
  if (separatorIndex === -1) {
    return null;
  }
  const companyId = id.slice(0, separatorIndex);
  const externalId = id.slice(separatorIndex + 1);

  const db = getDb();
  const now = new Date();

  const [row] = await db.execute<OpenJobRow>(sql`
    ${openJobsCte}
    SELECT
      oj.company_id, oj.external_id, oj.metadata, oj.posted_at, oj.state_at AS updated_at,
      c.slug AS company_slug, c.name AS company_name,
      c.careers_page_url AS company_careers_page_url, c.website_url AS company_website_url
    FROM open_jobs oj
    JOIN company c ON c.id = oj.company_id
    WHERE oj.company_id = ${companyId} AND oj.external_id = ${externalId}
    LIMIT 1
  `);

  if (!row) {
    return null;
  }

  const [skillsByJob, viewerProfile] = await Promise.all([
    fetchJobSkillsByCompanyExternalId([row]),
    viewerId ? getViewerRelevanceProfile(viewerId) : Promise.resolve(null),
  ]);

  const detectedSkillIds = skillsByJob.get(`${row.company_id}:${row.external_id}`) ?? [];
  const relevance = viewerProfile
    ? computeJobRelevance(
        {
          title: row.metadata.title,
          departmentNames: row.metadata.departmentNames,
          workplaceType: asWorkplaceType(row.metadata.workplaceType),
        },
        detectedSkillIds,
        viewerProfile,
        new Map(),
      )
    : null;

  const skillById = await resolveSkillNamesById([
    ...detectedSkillIds,
    ...(relevance?.matchedSkillIds ?? []),
  ]);

  return toJobFeedItemDTO(row, now, detectedSkillIds, skillById, relevance);
}
