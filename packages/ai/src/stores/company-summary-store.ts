import { getDb, schema } from "@web3-hunter/db";
import { publishEventSafely } from "@web3-hunter/events";
import { desc, eq } from "drizzle-orm";
import { deriveArtifactId } from "../artifact-id";
import { CompanySummaryGenerated } from "../event-types";
import {
  buildCompanySummaryPrompt,
  COMPANY_SUMMARY_PROMPT_VERSION,
} from "../prompts/company-summary-prompt";
import { getAIProvider } from "../provider-factory";
import { findLatestEventIdForEntity } from "../provenance";
import { withRetry } from "../retry";
import { toArtifactResult, type AIGenerationOutcome } from "../types";
import { validateAIOutput } from "../validation";

const ARTIFACT_TYPE = "company-summary";

export async function getOrGenerateCompanySummary(companyId: string): Promise<AIGenerationOutcome> {
  const provider = getAIProvider();
  if (!provider) {
    return { available: false };
  }

  const db = getDb();

  const [company] = await db
    .select()
    .from(schema.company)
    .where(eq(schema.company.id, companyId))
    .limit(1);
  const [intelligence] = await db
    .select()
    .from(schema.companyIntelligence)
    .where(eq(schema.companyIntelligence.companyId, companyId))
    .limit(1);
  if (!company || !intelligence) {
    return { available: false };
  }

  const signals = await db
    .select()
    .from(schema.signal)
    .where(eq(schema.signal.companyId, companyId))
    .orderBy(desc(schema.signal.detectedAt))
    .limit(5);

  const [existing] = await db
    .select()
    .from(schema.companySummary)
    .where(eq(schema.companySummary.companyId, companyId))
    .orderBy(desc(schema.companySummary.version))
    .limit(1);

  if (existing && existing.promptVersion === COMPANY_SUMMARY_PROMPT_VERSION) {
    return { available: true, cached: true, artifact: toArtifactResult(existing) };
  }

  const prompt = buildCompanySummaryPrompt({
    companyName: company.name,
    trend: intelligence.trend,
    confidence: intelligence.confidence,
    signalCount: intelligence.signalCount,
    recentSignalSummaries: signals.map((signal) => ({
      signalType: signal.signalType,
      weight: signal.weight,
      reasoning: signal.reasoning,
    })),
  });

  const result = await withRetry(() => provider.generate({ prompt }));
  const content = validateAIOutput(result.content);

  const version = (existing?.version ?? 0) + 1;
  const artifactId = deriveArtifactId(ARTIFACT_TYPE, companyId, version);
  const generatedAt = new Date();

  const provenanceEventId = await findLatestEventIdForEntity({
    type: "IntelligenceUpdated",
    relatedEntityType: "company",
    relatedEntityId: companyId,
  });

  await publishEventSafely({
    id: artifactId,
    type: CompanySummaryGenerated.name,
    metadata: {
      artifactId,
      version,
      promptVersion: COMPANY_SUMMARY_PROMPT_VERSION,
      provider: provider.name,
      model: result.model,
      companyId,
    },
    occurredAt: generatedAt,
    confidence: 1,
    sourceLabel: "ai-layer",
    relatedEntityType: "company",
    relatedEntityId: companyId,
    provenance: provenanceEventId ? [provenanceEventId] : [],
  });

  await db
    .insert(schema.companySummary)
    .values({
      id: artifactId,
      companyId,
      content,
      version,
      promptVersion: COMPANY_SUMMARY_PROMPT_VERSION,
      provider: provider.name,
      model: result.model,
      generatedAt,
    })
    .onConflictDoNothing({ target: schema.companySummary.id });

  return {
    available: true,
    cached: false,
    artifact: {
      content,
      version,
      promptVersion: COMPANY_SUMMARY_PROMPT_VERSION,
      provider: provider.name,
      model: result.model,
      generatedAt,
    },
  };
}
