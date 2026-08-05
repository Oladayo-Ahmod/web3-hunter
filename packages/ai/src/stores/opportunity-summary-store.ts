import { getDb, schema } from "@web3-hunter/db";
import { publishEventSafely } from "@web3-hunter/events";
import { desc, eq } from "drizzle-orm";
import { deriveArtifactId } from "../artifact-id";
import { OpportunitySummaryGenerated } from "../event-types";
import {
  buildOpportunitySummaryPrompt,
  OPPORTUNITY_SUMMARY_PROMPT_VERSION,
} from "../prompts/opportunity-summary-prompt";
import { getAIProvider } from "../provider-factory";
import { findLatestEventId } from "../provenance";
import { withRetry } from "../retry";
import { toArtifactResult, type AIGenerationOutcome } from "../types";
import { validateAIOutput } from "../validation";

const ARTIFACT_TYPE = "opportunity-summary";

export async function getOrGenerateOpportunitySummary(
  opportunityId: string,
): Promise<AIGenerationOutcome> {
  const provider = getAIProvider();
  if (!provider) {
    return { available: false };
  }

  const db = getDb();

  const [opportunity] = await db
    .select()
    .from(schema.opportunity)
    .where(eq(schema.opportunity.id, opportunityId))
    .limit(1);
  if (!opportunity) {
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

  const signals = await db
    .select()
    .from(schema.signal)
    .where(eq(schema.signal.companyId, opportunity.companyId))
    .orderBy(desc(schema.signal.detectedAt))
    .limit(5);

  const [existing] = await db
    .select()
    .from(schema.opportunitySummary)
    .where(eq(schema.opportunitySummary.opportunityId, opportunityId))
    .orderBy(desc(schema.opportunitySummary.version))
    .limit(1);

  if (existing && existing.promptVersion === OPPORTUNITY_SUMMARY_PROMPT_VERSION) {
    return { available: true, cached: true, artifact: toArtifactResult(existing) };
  }

  const prompt = buildOpportunitySummaryPrompt({
    companyName: company.name,
    opportunityType: opportunity.opportunityType,
    score: opportunity.score ?? 0,
    reasoning: opportunity.reasoning,
    signalSummaries: signals.map((signal) => ({
      signalType: signal.signalType,
      weight: signal.weight,
      reasoning: signal.reasoning,
    })),
  });

  const result = await withRetry(() => provider.generate({ prompt }));
  const content = validateAIOutput(result.content);

  const version = (existing?.version ?? 0) + 1;
  const artifactId = deriveArtifactId(ARTIFACT_TYPE, opportunityId, version);
  const generatedAt = new Date();

  const provenanceEventId = await findLatestEventId({
    type: "OpportunityScored",
    relatedEntityType: "company",
    relatedEntityId: opportunity.companyId,
    metadataKey: "opportunityId",
    metadataValue: opportunityId,
  });

  await publishEventSafely({
    id: artifactId,
    type: OpportunitySummaryGenerated.name,
    metadata: {
      artifactId,
      version,
      promptVersion: OPPORTUNITY_SUMMARY_PROMPT_VERSION,
      provider: provider.name,
      model: result.model,
      opportunityId,
    },
    occurredAt: generatedAt,
    confidence: 1,
    sourceLabel: "ai-layer",
    relatedEntityType: "company",
    relatedEntityId: opportunity.companyId,
    provenance: provenanceEventId ? [provenanceEventId] : [],
  });

  await db
    .insert(schema.opportunitySummary)
    .values({
      id: artifactId,
      opportunityId,
      content,
      version,
      promptVersion: OPPORTUNITY_SUMMARY_PROMPT_VERSION,
      provider: provider.name,
      model: result.model,
      generatedAt,
    })
    .onConflictDoNothing({ target: schema.opportunitySummary.id });

  return {
    available: true,
    cached: false,
    artifact: {
      content,
      version,
      promptVersion: OPPORTUNITY_SUMMARY_PROMPT_VERSION,
      provider: provider.name,
      model: result.model,
      generatedAt,
    },
  };
}
