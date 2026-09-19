import { getDb, schema } from "@web3-hunter/db";
import { eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { CompanyPriorityDTO, JobFeedItemDTO, PaginatedResult, SkillDTO } from "./dto";
import { ensureJobEligibility, jobEligibilityIsCurrent } from "./job-eligibility-service";
import { computeJobFreshness, JOB_FRESHNESS_LEVELS, type JobFreshness } from "./job-freshness";
import {
  computeJobRelevance,
  TARGET_ROLES,
  type JobRelevanceProfile,
  type JobRelevanceResult,
} from "./job-relevance";
import { resolveSkillsById } from "./skill-lookup";

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
 *
 * `eligibleOnly` (Milestone 22): the default `/jobs` view now runs every
 * candidate through `apply-eligibility.ts`'s gate — the same one that
 * fixed `/today`'s Apply section — rather than showing every open
 * posting at every curated Company regardless of role. Pass
 * `eligibleOnly=false` for the explicit "show everything, including
 * roles this gate would normally hide" escape hatch (mirrors
 * `includeStale`'s own opt-out shape); never silently dropped without a
 * way back to the full set.
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
  eligibleOnly: z.coerce.boolean().default(true),
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
  company_priority: CompanyPriorityDTO | null;
};

/**
 * Everything about the viewing User needed to score a Job — resolved
 * once per `listJobFeed` call, not once per Job. `null` when there's no
 * viewer, or the viewer hasn't created a Profile yet (same "may start
 * minimal" state `packages/matching`'s `getUserProfile` already treats
 * as absent, not empty).
 *
 * Exported (Milestone 14) so offline measurement scripts — e.g.
 * `apps/web/scripts/measure-discovery-relevance.ts` — can score the real
 * job pool against the real saved Profile without re-implementing this
 * query.
 */
export async function getViewerRelevanceProfile(
  viewerId: string,
): Promise<JobRelevanceProfile | null> {
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
    locationConstraint: profileRow.locationConstraint,
  };
}

/**
 * Batch-fetches `job_skill` for every `(companyId, externalId)` pair
 * among the given rows in one query — filtered by `inArray(companyId,
 * …)` (indexed), not a tuple-IN, then grouped client-side, the same
 * "one query, not N" discipline `resolveSkillsById` follows for Matches.
 * Harmless over-fetch (a company's *other* Jobs' skills come along for
 * the ride) is discarded when grouping, not queried around, since the
 * set of distinct companies on one page is almost always small.
 *
 * Uses drizzle's `inArray()` query-builder operator, not a raw SQL
 * `= ANY(${array})` string — the latter looks equivalent but doesn't
 * correctly bind a JS array as a Postgres array parameter through
 * postgres-js (confirmed against real production data: it fails with
 * "malformed array literal" whenever the array has exactly one element).
 * `inArray()` is this codebase's one, already-proven way to do this
 * (see `resolveSkillsById`) — reused here, not reinvented.
 */
async function fetchJobSkillsByCompanyExternalId(
  rows: readonly Pick<OpenJobRow, "company_id" | "external_id">[],
): Promise<Map<string, string[]>> {
  const companyIds = [...new Set(rows.map((row) => row.company_id))];
  if (companyIds.length === 0) {
    return new Map();
  }

  const skillRows = await getDb()
    .select({
      companyId: schema.jobSkill.companyId,
      externalId: schema.jobSkill.externalId,
      skillId: schema.jobSkill.skillId,
    })
    .from(schema.jobSkill)
    .where(inArray(schema.jobSkill.companyId, companyIds));

  const wanted = new Set(rows.map((row) => `${row.company_id}:${row.external_id}`));
  const bySkillKey = new Map<string, string[]>();
  for (const row of skillRows) {
    const key = `${row.companyId}:${row.externalId}`;
    if (!wanted.has(key)) {
      continue;
    }
    const existing = bySkillKey.get(key) ?? [];
    existing.push(row.skillId);
    bySkillKey.set(key, existing);
  }
  return bySkillKey;
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
      priority: row.company_priority,
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
      id AS state_event_id,
      related_entity_id AS company_id,
      metadata->>'externalId' AS external_id,
      metadata,
      occurred_at AS state_at
    FROM event
    WHERE type IN ('JobPosted', 'JobUpdated') AND related_entity_type = 'company'
    ORDER BY related_entity_id, metadata->>'externalId', occurred_at DESC, id DESC
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
    SELECT ls.state_event_id, ls.company_id, ls.external_id, ls.metadata, ls.state_at, p.posted_at
    FROM latest_state ls
    JOIN posted p ON p.company_id = ls.company_id AND p.external_id = ls.external_id
    LEFT JOIN closures cl ON cl.company_id = ls.company_id AND cl.external_id = ls.external_id
    -- Milestone 13 Phase C: a "rejected" Company (discovery-probe.md's
    -- doc comment - a probe hit that resolved to the wrong real-world
    -- company, or a duplicate of an already-curated one) must never
    -- surface jobs, no matter which query below reads from this CTE.
    -- Filtered once, here, rather than at each of listJobFeed's several
    -- call sites, so this can't be forgotten at a new one later.
    JOIN company c ON c.id = ls.company_id AND c.discovery_status != 'rejected'
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

const PRIORITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };
function priorityRank(priority: CompanyPriorityDTO | null): number {
  return priority ? (PRIORITY_RANK[priority] ?? 3) : 3;
}

/** How many Jobs' descriptions one `fetchJobDescriptions` query looks up — keeps the query's parameter count small however large the feed is. */
const DESCRIPTION_LOOKUP_CHUNK_SIZE = 1000;

/**
 * Latest-state descriptions for the given Jobs, keyed
 * `${companyId}:${externalId}`. Descriptions are most of a job row's
 * bytes, so `listJobFeed` leaves them out of its main query and asks for
 * only the ones something will actually read: scoring (when the viewer
 * has a Profile) or the returned page's DTOs.
 */
async function fetchJobDescriptions(
  jobs: readonly Pick<OpenJobRow, "company_id" | "external_id">[],
): Promise<Map<string, string | null>> {
  const descriptions = new Map<string, string | null>();

  for (let start = 0; start < jobs.length; start += DESCRIPTION_LOOKUP_CHUNK_SIZE) {
    const pairs = sql.join(
      jobs
        .slice(start, start + DESCRIPTION_LOOKUP_CHUNK_SIZE)
        .map((job) => sql`(${job.company_id}::uuid, ${job.external_id})`),
      sql`, `,
    );

    const found = await getDb().execute<{
      company_id: string;
      external_id: string;
      description: string | null;
    }>(sql`
      SELECT DISTINCT ON (related_entity_id, metadata->>'externalId')
        related_entity_id AS company_id,
        metadata->>'externalId' AS external_id,
        metadata->>'description' AS description
      FROM event
      WHERE type IN ('JobPosted', 'JobUpdated')
        AND related_entity_type = 'company'
        AND (related_entity_id, metadata->>'externalId') IN (${pairs})
      ORDER BY related_entity_id, metadata->>'externalId', occurred_at DESC, id DESC
    `);

    for (const row of found) {
      descriptions.set(`${row.company_id}:${row.external_id}`, row.description);
    }
  }

  return descriptions;
}

function withDescription(
  row: OpenJobRow,
  descriptions: ReadonlyMap<string, string | null>,
): OpenJobRow {
  return {
    ...row,
    metadata: {
      ...row.metadata,
      description: descriptions.get(`${row.company_id}:${row.external_id}`) ?? null,
    },
  };
}

/** Upper bound on how many open Jobs `listJobFeed` pulls into memory to filter/score/sort — see that function's doc comment. Comfortably above real volume today (low thousands); revisit if it stops being so. */
const JOB_FEED_MAX_ROWS = 5000;

/**
 * The Job Feed read model. The job-listing counterpart to
 * `listOpportunityFeed` — same pagination/sort contract, same "one
 * Application Layer function owns this query" rule
 * (docs/ARCHITECTURE.md §6).
 *
 * Milestone 22 unified what used to be two separate code paths (a SQL-
 * paginated fast path, and a fetch-everything-then-sort-in-memory path
 * used only for `sort: "relevance"`) into one: `eligibleOnly`'s gate
 * (`apply-eligibility.ts` — the same one that fixed `/today`'s Apply
 * section) can only run in application code against a Job's title and
 * description, so every candidate now goes through that one bounded
 * fetch-then-filter-then-sort-then-paginate pipeline regardless of sort
 * mode, not just relevance sort. Cheap at today's volume (low
 * thousands); if that stops being true, this is exactly the computation
 * a persisted `job_match` read model (deferred in the Milestone 13
 * design doc, §3) would take over.
 *
 * `viewerId` (Milestone 13 Phase 2, mirrors `listOpportunityFeed`'s own
 * parameter): when supplied and that User has a Profile, every returned
 * Job carries a `relevance` score/breakdown against it, and `sort:
 * "relevance"` orders by that score. `minMatch` only filters in that
 * same case — there is no score to filter by otherwise, so it's
 * silently ignored (not an error) rather than erroring, mirroring
 * `listOpportunityFeed`'s own fallback.
 *
 * The default sort (`postedAt`) is startup-first, not just freshness-
 * first (Milestone 22 §"Startup-First"): a hand-curated 'high'-priority
 * Company's Jobs sort before 'medium', before 'low', before an
 * unclassified one — the same `company.priority` signal
 * `outreach-query-service.ts`/`daily-digest-service.ts` already sort
 * by — and only then by `postedAt` in the requested direction. Explicit
 * `sort: "relevance"` or `sort: "title"` bypass this entirely; the user
 * asked for a specific order and gets exactly that.
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

  if (query.eligibleOnly) {
    await ensureJobEligibility();
  }

  const viewerProfile = viewerId ? await getViewerRelevanceProfile(viewerId) : null;

  // Eligibility is decided here, in SQL, from the stored verdict
  // (`job_eligibility`) — not by downloading every open job's description
  // to run the gate in JS, which is what this used to do on every request
  // (up to `JOB_FEED_MAX_ROWS` full descriptions to render one page of 20,
  // and a large share of the Supabase egress that exhausted the project's
  // quota). `metadata - 'description'` drops the bulky field from every row;
  // descriptions are then fetched only for the rows that actually use one
  // (`fetchJobDescriptions`, below).
  const rows = await db.execute<OpenJobRow>(sql`
    ${openJobsCte}
    SELECT
      oj.company_id, oj.external_id, oj.metadata - 'description' AS metadata,
      oj.posted_at, oj.state_at AS updated_at,
      c.slug AS company_slug, c.name AS company_name,
      c.careers_page_url AS company_careers_page_url, c.website_url AS company_website_url,
      c.priority AS company_priority
    FROM open_jobs oj
    JOIN company c ON c.id = oj.company_id
    LEFT JOIN job_eligibility je
      ON je.company_id = oj.company_id
      AND je.external_id = oj.external_id
      AND ${jobEligibilityIsCurrent("oj")}
    WHERE true ${filter} ${query.eligibleOnly ? sql`AND je.eligible` : sql``}
    ORDER BY oj.posted_at DESC
    LIMIT ${JOB_FEED_MAX_ROWS}
  `);

  // Relevance scoring reads a posting's description, so a viewer with a
  // Profile needs it for every scored row; without one, only the returned
  // page needs it (below), for the DTO.
  const scoringDescriptions = viewerProfile
    ? await fetchJobDescriptions(rows)
    : new Map<string, string | null>();

  // Skill *names* are only needed for the final page after
  // scoring/sorting/pagination (below) — scoring itself only needs IDs.
  const skillsByJob = await fetchJobSkillsByCompanyExternalId(rows);

  const scored = rows.map((row) => {
    const detectedSkillIds = skillsByJob.get(`${row.company_id}:${row.external_id}`) ?? [];
    const relevance = viewerProfile
      ? computeJobRelevance(
          {
            title: row.metadata.title,
            departmentNames: row.metadata.departmentNames,
            workplaceType: asWorkplaceType(row.metadata.workplaceType),
            locationName: row.metadata.locationName,
            description: scoringDescriptions.get(`${row.company_id}:${row.external_id}`) ?? null,
          },
          detectedSkillIds,
          viewerProfile,
          new Map(), // names resolved once, below, after we know the final page
        )
      : null;
    return { row, detectedSkillIds, relevance };
  });

  const filtered =
    query.sort === "relevance" && viewerProfile && query.minMatch !== undefined
      ? scored.filter((entry) => (entry.relevance?.score ?? 0) >= query.minMatch!)
      : scored;

  const direction = query.direction === "asc" ? 1 : -1;
  filtered.sort((a, b) => {
    if (query.sort === "relevance" && viewerProfile) {
      return direction * ((a.relevance?.score ?? 0) - (b.relevance?.score ?? 0));
    }
    if (query.sort === "title") {
      return direction * a.row.metadata.title.localeCompare(b.row.metadata.title);
    }
    const priorityDelta =
      priorityRank(a.row.company_priority) - priorityRank(b.row.company_priority);
    if (priorityDelta !== 0) {
      return priorityDelta;
    }
    return direction * (new Date(a.row.posted_at).getTime() - new Date(b.row.posted_at).getTime());
  });

  const totalCount = filtered.length;
  const start = (query.page - 1) * query.pageSize;
  const page = filtered.slice(start, start + query.pageSize);

  const allSkillIds = page.flatMap((entry) => [
    ...entry.detectedSkillIds,
    ...(entry.relevance?.matchedSkillIds ?? []),
  ]);
  const resolvedSkillById = await resolveSkillsById(allSkillIds);
  const pageDescriptions = viewerProfile
    ? scoringDescriptions
    : await fetchJobDescriptions(page.map((entry) => entry.row));

  return {
    items: page.map((entry) =>
      toJobFeedItemDTO(
        withDescription(entry.row, pageDescriptions),
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
      c.careers_page_url AS company_careers_page_url, c.website_url AS company_website_url,
      c.priority AS company_priority
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
          locationName: row.metadata.locationName,
          description: row.metadata.description ?? null,
        },
        detectedSkillIds,
        viewerProfile,
        new Map(),
      )
    : null;

  const skillById = await resolveSkillsById([
    ...detectedSkillIds,
    ...(relevance?.matchedSkillIds ?? []),
  ]);

  return toJobFeedItemDTO(row, now, detectedSkillIds, skillById, relevance);
}
