import { getDb, schema } from "@web3-hunter/db";
import { publishEventSafely } from "@web3-hunter/events";
import { desc, eq, inArray } from "drizzle-orm";
import { deriveArtifactId } from "../artifact-id";
import { AIRecommendationGenerated } from "../event-types";
import { getAIProvider } from "../provider-factory";
import { RECOMMENDATION_EXPLANATION_PROMPT_VERSION } from "../prompts/recommendation-explanation-prompt";
import { buildRecommendationExplanationPrompt } from "../prompts/recommendation-explanation-prompt";
import { findLatestEventId } from "../provenance";
import { withRetry } from "../retry";
import { toArtifactResult, type AIGenerationOutcome } from "../types";
import { validateAIOutput } from "../validation";

const ARTIFACT_TYPE = "recommendation-explanation";

/**
 * Generates (or returns the cached) explanation for a Recommendation.
 * The deterministic `recommendation.reason` (Milestone 6) remains the
 * authoritative, always-available fact this supplements — this function
 * never overwrites it and is never on the critical path for viewing a
 * Recommendation.
 */
export async function getOrGenerateRecommendationExplanation(
  recommendationId: string,
): Promise<AIGenerationOutcome> {
  const provider = getAIProvider();
  if (!provider) {
    return { available: false };
  }

  const db = getDb();

  const [recommendation] = await db
    .select()
    .from(schema.recommendation)
    .where(eq(schema.recommendation.id, recommendationId))
    .limit(1);
  if (!recommendation) {
    return { available: false };
  }

  const [match] = await db
    .select()
    .from(schema.match)
    .where(eq(schema.match.id, recommendation.matchId))
    .limit(1);
  const [opportunity] = await db
    .select()
    .from(schema.opportunity)
    .where(eq(schema.opportunity.id, recommendation.opportunityId))
    .limit(1);
  if (!match || !opportunity) {
    return { available: false };
  }

  const [company] = await db
    .select()
    .from(schema.company)
    .where(eq(schema.company.id, opportunity.companyId))
    .limit(1);
  const [intelligence] = await db
    .select()
    .from(schema.companyIntelligence)
    .where(eq(schema.companyIntelligence.companyId, opportunity.companyId))
    .limit(1);
  if (!company || !intelligence) {
    return { available: false };
  }

  const matchedSkills =
    match.matchedSkillIds.length > 0
      ? await db.select().from(schema.skill).where(inArray(schema.skill.id, match.matchedSkillIds))
      : [];

  const [existing] = await db
    .select()
    .from(schema.recommendationExplanation)
    .where(eq(schema.recommendationExplanation.recommendationId, recommendationId))
    .orderBy(desc(schema.recommendationExplanation.version))
    .limit(1);

  if (existing && existing.promptVersion === RECOMMENDATION_EXPLANATION_PROMPT_VERSION) {
    return { available: true, cached: true, artifact: toArtifactResult(existing) };
  }

  const prompt = buildRecommendationExplanationPrompt({
    companyName: company.name,
    opportunityType: opportunity.opportunityType,
    matchScore: match.score,
    matchReasoning: match.reasoning,
    matchedSkillNames: matchedSkills.map((skill) => skill.name),
    intelligenceConfidence: intelligence.confidence,
    intelligenceTrend: intelligence.trend,
    priority: recommendation.priority,
  });

  const result = await withRetry(() => provider.generate({ prompt }));
  const content = validateAIOutput(result.content);

  const version = (existing?.version ?? 0) + 1;
  const artifactId = deriveArtifactId(ARTIFACT_TYPE, recommendationId, version);
  const generatedAt = new Date();

  const provenanceEventId = await findLatestEventId({
    type: "RecommendationCreated",
    relatedEntityType: "user",
    relatedEntityId: recommendation.userId,
    metadataKey: "recommendationId",
    metadataValue: recommendationId,
  });

  await publishEventSafely({
    id: artifactId,
    type: AIRecommendationGenerated.name,
    metadata: {
      artifactId,
      version,
      promptVersion: RECOMMENDATION_EXPLANATION_PROMPT_VERSION,
      provider: provider.name,
      model: result.model,
      recommendationId,
    },
    occurredAt: generatedAt,
    confidence: 1,
    sourceLabel: "ai-layer",
    relatedEntityType: "user",
    relatedEntityId: recommendation.userId,
    provenance: provenanceEventId ? [provenanceEventId] : [],
  });

  await db
    .insert(schema.recommendationExplanation)
    .values({
      id: artifactId,
      recommendationId,
      content,
      version,
      promptVersion: RECOMMENDATION_EXPLANATION_PROMPT_VERSION,
      provider: provider.name,
      model: result.model,
      generatedAt,
    })
    .onConflictDoNothing({ target: schema.recommendationExplanation.id });

  return {
    available: true,
    cached: false,
    artifact: {
      content,
      version,
      promptVersion: RECOMMENDATION_EXPLANATION_PROMPT_VERSION,
      provider: provider.name,
      model: result.model,
      generatedAt,
    },
  };
}
