import { getDb, schema } from "@web3-hunter/db";
import { and, desc, eq } from "drizzle-orm";
import {
  getLatestOutreachDraft,
  getLatestRecommendationExplanation,
  getLatestRecommendationExplanationsByIds,
} from "./ai-artifact-lookup";
import type {
  AIArtifactSummaryDTO,
  RecommendationDetailDTO,
  RecommendationStatusDTO,
  RecommendationSummaryDTO,
} from "./dto";
import { toOpportunityFeedItemDTO } from "./mappers";
import { getOpportunityDetail } from "./opportunity-query-service";
import { renderRecommendationReason } from "./recommendation-reason";
import { resolveSkillsById } from "./skill-lookup";

type RecommendationRow = typeof schema.recommendation.$inferSelect;

function toRecommendationSummaryDTO(
  row: RecommendationRow,
  opportunity: Parameters<typeof toOpportunityFeedItemDTO>[0],
  company: Parameters<typeof toOpportunityFeedItemDTO>[1],
  match: Parameters<typeof toOpportunityFeedItemDTO>[2],
  skillById: Parameters<typeof toOpportunityFeedItemDTO>[3],
  aiExplanation: AIArtifactSummaryDTO | null,
): RecommendationSummaryDTO {
  return {
    id: row.id,
    status: row.status,
    priority: row.priority,
    reason: renderRecommendationReason(
      row.reasonCode,
      row.reasonDetails as Record<string, unknown>,
      row.reasonVersion,
    ),
    createdAt: row.createdAt.toISOString(),
    statusChangedAt: row.statusChangedAt.toISOString(),
    opportunity: toOpportunityFeedItemDTO(opportunity, company, match, skillById),
    aiExplanation,
  };
}

/**
 * The Recommendation Feed read model — authenticated-only, unlike the
 * public Opportunity Feed: there is no anonymous path, since a
 * Recommendation belongs to exactly one User and must never leak to
 * another (docs/DOMAIN_MODEL.md §Recommendation). `userId` must come from
 * the caller's resolved session, never a client-supplied parameter.
 */
export async function listRecommendations(
  userId: string,
  status?: RecommendationStatusDTO,
): Promise<RecommendationSummaryDTO[]> {
  const db = getDb();
  const conditions = [eq(schema.recommendation.userId, userId)];
  if (status !== undefined) {
    conditions.push(eq(schema.recommendation.status, status));
  }

  const rows = await db
    .select({
      recommendation: schema.recommendation,
      opportunity: schema.opportunity,
      company: schema.company,
      match: schema.match,
    })
    .from(schema.recommendation)
    .innerJoin(schema.opportunity, eq(schema.recommendation.opportunityId, schema.opportunity.id))
    .innerJoin(schema.company, eq(schema.opportunity.companyId, schema.company.id))
    .innerJoin(schema.match, eq(schema.recommendation.matchId, schema.match.id))
    .where(and(...conditions))
    .orderBy(desc(schema.recommendation.priority));

  const [skillById, aiExplanationById] = await Promise.all([
    resolveSkillsById(rows.flatMap((row) => row.match.matchedSkillIds)),
    getLatestRecommendationExplanationsByIds(rows.map((row) => row.recommendation.id)),
  ]);

  return rows.map((row) =>
    toRecommendationSummaryDTO(
      row.recommendation,
      row.opportunity,
      row.company,
      row.match,
      skillById,
      aiExplanationById.get(row.recommendation.id) ?? null,
    ),
  );
}

/**
 * The Recommendation Detail read model — reuses `getOpportunityDetail`
 * for the Opportunity side (signals, Company Intelligence, freshness, and
 * this same User's Match), so there is exactly one place that assembles
 * that shape, not two. Returns `null` both for an unknown Recommendation
 * ID and for one that belongs to a different User — a caller must never
 * be able to distinguish "doesn't exist" from "isn't yours."
 */
export async function getRecommendationDetail(
  id: string,
  userId: string,
): Promise<RecommendationDetailDTO | null> {
  const db = getDb();

  const [row] = await db
    .select()
    .from(schema.recommendation)
    .where(and(eq(schema.recommendation.id, id), eq(schema.recommendation.userId, userId)))
    .limit(1);
  if (!row) {
    return null;
  }

  const [opportunity, aiExplanation, aiOutreachDraft] = await Promise.all([
    getOpportunityDetail(row.opportunityId, userId),
    getLatestRecommendationExplanation(row.id),
    getLatestOutreachDraft(row.id),
  ]);
  if (!opportunity) {
    return null;
  }

  return {
    id: row.id,
    status: row.status,
    priority: row.priority,
    reason: renderRecommendationReason(
      row.reasonCode,
      row.reasonDetails as Record<string, unknown>,
      row.reasonVersion,
    ),
    createdAt: row.createdAt.toISOString(),
    statusChangedAt: row.statusChangedAt.toISOString(),
    opportunity,
    aiExplanation,
    aiOutreachDraft,
  };
}
