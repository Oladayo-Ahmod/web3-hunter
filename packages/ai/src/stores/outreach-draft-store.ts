import { getDb, schema } from "@web3-hunter/db";
import { publishEventSafely } from "@web3-hunter/events";
import { desc, eq, inArray } from "drizzle-orm";
import { deriveArtifactId } from "../artifact-id";
import { OutreachDraftGenerated } from "../event-types";
import {
  buildOutreachDraftPrompt,
  OUTREACH_DRAFT_PROMPT_VERSION,
} from "../prompts/outreach-draft-prompt";
import { getAIProvider } from "../provider-factory";
import { findLatestEventId } from "../provenance";
import { withRetry } from "../retry";
import { toArtifactResult, type AIGenerationOutcome } from "../types";
import { validateAIOutput } from "../validation";

const ARTIFACT_TYPE = "outreach-draft";

export async function getOrGenerateOutreachDraft(
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
  if (!company) {
    return { available: false };
  }

  const matchedSkills =
    match.matchedSkillIds.length > 0
      ? await db.select().from(schema.skill).where(inArray(schema.skill.id, match.matchedSkillIds))
      : [];

  const [existing] = await db
    .select()
    .from(schema.outreachDraft)
    .where(eq(schema.outreachDraft.recommendationId, recommendationId))
    .orderBy(desc(schema.outreachDraft.version))
    .limit(1);

  if (existing && existing.promptVersion === OUTREACH_DRAFT_PROMPT_VERSION) {
    return { available: true, cached: true, artifact: toArtifactResult(existing) };
  }

  const prompt = buildOutreachDraftPrompt({
    companyName: company.name,
    opportunityType: opportunity.opportunityType,
    matchedSkillNames: matchedSkills.map((skill) => skill.name),
    matchReasoning: match.reasoning,
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
    type: OutreachDraftGenerated.name,
    metadata: {
      artifactId,
      version,
      promptVersion: OUTREACH_DRAFT_PROMPT_VERSION,
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
    .insert(schema.outreachDraft)
    .values({
      id: artifactId,
      recommendationId,
      content,
      version,
      promptVersion: OUTREACH_DRAFT_PROMPT_VERSION,
      provider: provider.name,
      model: result.model,
      generatedAt,
    })
    .onConflictDoNothing({ target: schema.outreachDraft.id });

  return {
    available: true,
    cached: false,
    artifact: {
      content,
      version,
      promptVersion: OUTREACH_DRAFT_PROMPT_VERSION,
      provider: provider.name,
      model: result.model,
      generatedAt,
    },
  };
}
