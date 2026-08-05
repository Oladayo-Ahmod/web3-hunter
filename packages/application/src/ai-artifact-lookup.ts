import { getDb, schema } from "@web3-hunter/db";
import { desc, eq, inArray } from "drizzle-orm";
import type { AIArtifactSummaryDTO } from "./dto";

/**
 * Reads the latest cached AI artifact for a source entity — a read of
 * whatever `packages/ai` last persisted, exactly the same
 * read-materialized-projection-directly pattern this package already
 * uses for Match/Skill data. Never triggers generation, never imports
 * `packages/ai`: if nothing has been generated yet, this returns `null`
 * and the deterministic data remains fully usable on its own (Milestone
 * 7's "AI is optional" requirement, enforced structurally here too).
 */
function toAIArtifactSummaryDTO(row: {
  content: string;
  version: number;
  generatedAt: Date;
}): AIArtifactSummaryDTO {
  return { content: row.content, version: row.version, generatedAt: row.generatedAt.toISOString() };
}

export async function getLatestRecommendationExplanation(
  recommendationId: string,
): Promise<AIArtifactSummaryDTO | null> {
  const [row] = await getDb()
    .select()
    .from(schema.recommendationExplanation)
    .where(eq(schema.recommendationExplanation.recommendationId, recommendationId))
    .orderBy(desc(schema.recommendationExplanation.version))
    .limit(1);
  return row ? toAIArtifactSummaryDTO(row) : null;
}

/**
 * Batched sibling of `getLatestRecommendationExplanation`, for a list
 * page rendering many Recommendations at once — one query for the whole
 * page rather than one per row, per CLAUDE.md's "never perform N+1
 * queries." Keeps only the highest `version` row per Recommendation.
 */
export async function getLatestRecommendationExplanationsByIds(
  recommendationIds: readonly string[],
): Promise<Map<string, AIArtifactSummaryDTO>> {
  if (recommendationIds.length === 0) {
    return new Map();
  }

  const rows = await getDb()
    .select()
    .from(schema.recommendationExplanation)
    .where(inArray(schema.recommendationExplanation.recommendationId, [...recommendationIds]))
    .orderBy(desc(schema.recommendationExplanation.version));

  const latestByRecommendationId = new Map<string, AIArtifactSummaryDTO>();
  for (const row of rows) {
    if (!latestByRecommendationId.has(row.recommendationId)) {
      latestByRecommendationId.set(row.recommendationId, toAIArtifactSummaryDTO(row));
    }
  }
  return latestByRecommendationId;
}

export async function getLatestOutreachDraft(
  recommendationId: string,
): Promise<AIArtifactSummaryDTO | null> {
  const [row] = await getDb()
    .select()
    .from(schema.outreachDraft)
    .where(eq(schema.outreachDraft.recommendationId, recommendationId))
    .orderBy(desc(schema.outreachDraft.version))
    .limit(1);
  return row ? toAIArtifactSummaryDTO(row) : null;
}

export async function getLatestOpportunitySummary(
  opportunityId: string,
): Promise<AIArtifactSummaryDTO | null> {
  const [row] = await getDb()
    .select()
    .from(schema.opportunitySummary)
    .where(eq(schema.opportunitySummary.opportunityId, opportunityId))
    .orderBy(desc(schema.opportunitySummary.version))
    .limit(1);
  return row ? toAIArtifactSummaryDTO(row) : null;
}

export async function getLatestCompanySummary(
  companyId: string,
): Promise<AIArtifactSummaryDTO | null> {
  const [row] = await getDb()
    .select()
    .from(schema.companySummary)
    .where(eq(schema.companySummary.companyId, companyId))
    .orderBy(desc(schema.companySummary.version))
    .limit(1);
  return row ? toAIArtifactSummaryDTO(row) : null;
}

export async function getLatestProfileInsight(
  userId: string,
): Promise<AIArtifactSummaryDTO | null> {
  const [row] = await getDb()
    .select()
    .from(schema.profileInsight)
    .where(eq(schema.profileInsight.userId, userId))
    .orderBy(desc(schema.profileInsight.version))
    .limit(1);
  return row ? toAIArtifactSummaryDTO(row) : null;
}
