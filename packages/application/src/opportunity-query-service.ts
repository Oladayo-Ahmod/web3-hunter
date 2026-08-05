import { getDb, schema } from "@web3-hunter/db";
import { and, count, desc, eq, gte, lte, type SQL, sql } from "drizzle-orm";
import { z } from "zod";
import { getLatestOpportunitySummary } from "./ai-artifact-lookup";
import type { OpportunityDetailDTO, OpportunityFeedItemDTO, PaginatedResult } from "./dto";
import {
  toCompanyIntelligenceSummaryDTO,
  toOpportunityFeedItemDTO,
  toSignalSummaryDTO,
} from "./mappers";
import { resolveSkillsById } from "./skill-lookup";

export const OPPORTUNITY_SORT_FIELDS = ["score", "detectedAt", "scoredAt", "relevance"] as const;
export type OpportunitySortField = (typeof OPPORTUNITY_SORT_FIELDS)[number];

export const OPPORTUNITY_STATUSES = ["detected", "scored"] as const;

/**
 * Validates and applies defaults to raw Opportunity Feed query input — the
 * same schema is used to parse an API route's URL search params and to
 * type-check a Server Component's direct call, so both consumers get
 * identical validation for free (docs/ARCHITECTURE.md §6, Application
 * Layer refinement).
 */
export const opportunityFeedQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.enum(OPPORTUNITY_SORT_FIELDS).default("score"),
  direction: z.enum(["asc", "desc"]).default("desc"),
  opportunityType: z.string().min(1).optional(),
  status: z.enum(OPPORTUNITY_STATUSES).optional(),
  minScore: z.coerce.number().min(0).max(1).optional(),
  detectedAfter: z.coerce.date().optional(),
  detectedBefore: z.coerce.date().optional(),
});
export type OpportunityFeedQuery = z.infer<typeof opportunityFeedQuerySchema>;

function buildFeedConditions(query: OpportunityFeedQuery): SQL[] {
  const conditions: SQL[] = [];

  if (query.opportunityType !== undefined) {
    conditions.push(eq(schema.opportunity.opportunityType, query.opportunityType));
  }
  if (query.status !== undefined) {
    conditions.push(eq(schema.opportunity.status, query.status));
  }
  if (query.minScore !== undefined) {
    conditions.push(gte(schema.opportunity.score, query.minScore));
  }
  if (query.detectedAfter !== undefined) {
    conditions.push(gte(schema.opportunity.detectedAt, query.detectedAfter));
  }
  if (query.detectedBefore !== undefined) {
    conditions.push(lte(schema.opportunity.detectedAt, query.detectedBefore));
  }

  return conditions;
}

function buildOrderBy(sort: OpportunitySortField, direction: "asc" | "desc"): SQL {
  const column =
    sort === "score" || sort === "relevance"
      ? sort === "relevance"
        ? schema.match.score
        : schema.opportunity.score
      : sort === "scoredAt"
        ? schema.opportunity.scoredAt
        : schema.opportunity.detectedAt;

  // Sortable-but-nullable columns (`score`, `scoredAt`, a viewer's Match
  // score) should push not-yet-scored/matched Opportunities to the end
  // regardless of direction, so an explicit NULLS clause is used rather
  // than relying on Postgres's direction-dependent default.
  return direction === "asc" ? sql`${column} ASC NULLS LAST` : sql`${column} DESC NULLS LAST`;
}

/**
 * The Opportunity Feed read model (docs/DATABASE.md §6): a paginated,
 * sorted, filtered list of Opportunities for public browsing. This is the
 * only place in the system allowed to compose this query — no API route or
 * UI component queries `packages/db` directly.
 *
 * `viewerId` must come from the caller's resolved session — never from a
 * client-supplied query parameter, since it would let one User read
 * another's Match data. When present, each item includes that viewer's
 * Match (score, reasoning, matched Skills) if one has been computed, and
 * `sort: "relevance"` orders by it. Without a viewer, `"relevance"` falls
 * back to the default score-based order rather than erroring — there's
 * nothing to rank by for an anonymous visitor.
 */
export async function listOpportunityFeed(
  query: OpportunityFeedQuery,
  viewerId?: string,
): Promise<PaginatedResult<OpportunityFeedItemDTO>> {
  const db = getDb();
  const conditions = buildFeedConditions(query);
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [countRow] = await db
    .select({ value: count() })
    .from(schema.opportunity)
    .where(whereClause);
  const totalCount = countRow?.value ?? 0;

  const effectiveSort: OpportunitySortField =
    query.sort === "relevance" && !viewerId ? "score" : query.sort;

  const matchJoinCondition = viewerId
    ? and(eq(schema.match.opportunityId, schema.opportunity.id), eq(schema.match.userId, viewerId))
    : sql`false`;

  const rows = await db
    .select({ opportunity: schema.opportunity, company: schema.company, match: schema.match })
    .from(schema.opportunity)
    .innerJoin(schema.company, eq(schema.opportunity.companyId, schema.company.id))
    .leftJoin(schema.match, matchJoinCondition)
    .where(whereClause)
    .orderBy(buildOrderBy(effectiveSort, query.direction))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize);

  const skillById = await resolveSkillsById(
    rows.flatMap((row) => row.match?.matchedSkillIds ?? []),
  );

  return {
    items: rows.map((row) =>
      toOpportunityFeedItemDTO(row.opportunity, row.company, row.match, skillById),
    ),
    page: query.page,
    pageSize: query.pageSize,
    totalCount,
    totalPages: totalCount === 0 ? 0 : Math.ceil(totalCount / query.pageSize),
  };
}

/**
 * The Opportunity Detail read model: everything the explainability UI
 * needs for one Opportunity — score, reasoning, the Signals that produced
 * it, the Company Intelligence context around it, and (with a `viewerId`)
 * that viewer's Match. Returns `null` for an unknown ID rather than
 * throwing, since "not found" is an expected outcome for a public detail
 * page.
 */
export async function getOpportunityDetail(
  id: string,
  viewerId?: string,
): Promise<OpportunityDetailDTO | null> {
  const db = getDb();

  const [row] = await db
    .select({ opportunity: schema.opportunity, company: schema.company })
    .from(schema.opportunity)
    .innerJoin(schema.company, eq(schema.opportunity.companyId, schema.company.id))
    .where(eq(schema.opportunity.id, id))
    .limit(1);

  if (!row) {
    return null;
  }

  const [signalRows, intelligenceRows, matchRows, aiSummary] = await Promise.all([
    db
      .select()
      .from(schema.signal)
      .where(eq(schema.signal.companyId, row.opportunity.companyId))
      .orderBy(desc(schema.signal.detectedAt)),
    db
      .select()
      .from(schema.companyIntelligence)
      .where(eq(schema.companyIntelligence.companyId, row.opportunity.companyId))
      .limit(1),
    viewerId
      ? db
          .select()
          .from(schema.match)
          .where(and(eq(schema.match.opportunityId, id), eq(schema.match.userId, viewerId)))
          .limit(1)
      : Promise.resolve([]),
    getLatestOpportunitySummary(id),
  ]);

  const companyIntelligence = intelligenceRows[0]
    ? toCompanyIntelligenceSummaryDTO(intelligenceRows[0])
    : null;
  const matchRow = matchRows[0] ?? null;
  const skillById = await resolveSkillsById(matchRow?.matchedSkillIds ?? []);

  return {
    ...toOpportunityFeedItemDTO(row.opportunity, row.company, matchRow, skillById),
    reasoning: row.opportunity.reasoning,
    signals: signalRows.map(toSignalSummaryDTO),
    companyIntelligence,
    freshness: {
      lastSignalAt: companyIntelligence?.lastSignalAt ?? null,
      asOf: companyIntelligence?.asOf ?? null,
    },
    aiSummary,
  };
}
