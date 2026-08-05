import { getDb, schema } from "@web3-hunter/db";
import { publishEventSafely } from "@web3-hunter/events";
import { desc, eq, inArray } from "drizzle-orm";
import { deriveArtifactId } from "../artifact-id";
import { ProfileInsightGenerated } from "../event-types";
import {
  buildProfileInsightPrompt,
  PROFILE_INSIGHT_PROMPT_VERSION,
} from "../prompts/profile-insight-prompt";
import { getAIProvider } from "../provider-factory";
import { findLatestEventIdForEntity } from "../provenance";
import { withRetry } from "../retry";
import { toArtifactResult, type AIGenerationOutcome } from "../types";
import { validateAIOutput } from "../validation";

const ARTIFACT_TYPE = "profile-insight";

/**
 * Generates (or returns the cached) Profile Insight — requires at least
 * one Match to exist for the User, so the insight is grounded in real
 * comparisons rather than the User's self-declared Skills alone (a
 * User Profile is never event-sourced — it's self-reported input, not a
 * derived fact — so a Match is the nearest deterministic Event this can
 * cite as provenance).
 */
export async function getOrGenerateProfileInsight(userId: string): Promise<AIGenerationOutcome> {
  const provider = getAIProvider();
  if (!provider) {
    return { available: false };
  }

  const db = getDb();

  const [profile] = await db
    .select()
    .from(schema.userProfile)
    .where(eq(schema.userProfile.userId, userId))
    .limit(1);
  if (!profile) {
    return { available: false };
  }

  const userSkillRows = await db
    .select()
    .from(schema.userSkill)
    .where(eq(schema.userSkill.userId, userId));
  const skillIds = userSkillRows.map((row) => row.skillId);
  const skills =
    skillIds.length > 0
      ? await db.select().from(schema.skill).where(inArray(schema.skill.id, skillIds))
      : [];
  const dealBreakerSkills =
    profile.dealBreakerSkillIds.length > 0
      ? await db
          .select()
          .from(schema.skill)
          .where(inArray(schema.skill.id, profile.dealBreakerSkillIds))
      : [];

  const matches = await db
    .select({ match: schema.match, company: schema.company })
    .from(schema.match)
    .innerJoin(schema.opportunity, eq(schema.match.opportunityId, schema.opportunity.id))
    .innerJoin(schema.company, eq(schema.opportunity.companyId, schema.company.id))
    .where(eq(schema.match.userId, userId))
    .orderBy(desc(schema.match.score))
    .limit(5);

  if (matches.length === 0) {
    return { available: false };
  }

  const [existing] = await db
    .select()
    .from(schema.profileInsight)
    .where(eq(schema.profileInsight.userId, userId))
    .orderBy(desc(schema.profileInsight.version))
    .limit(1);

  if (existing && existing.promptVersion === PROFILE_INSIGHT_PROMPT_VERSION) {
    return { available: true, cached: true, artifact: toArtifactResult(existing) };
  }

  const prompt = buildProfileInsightPrompt({
    skillNames: skills.map((skill) => skill.name),
    dealBreakerSkillNames: dealBreakerSkills.map((skill) => skill.name),
    matchSummaries: matches.map((row) => ({
      companyName: row.company.name,
      score: row.match.score,
    })),
  });

  const result = await withRetry(() => provider.generate({ prompt }));
  const content = validateAIOutput(result.content);

  const version = (existing?.version ?? 0) + 1;
  const artifactId = deriveArtifactId(ARTIFACT_TYPE, userId, version);
  const generatedAt = new Date();

  const provenanceEventId = await findLatestEventIdForEntity({
    type: "MatchComputed",
    relatedEntityType: "user",
    relatedEntityId: userId,
  });

  await publishEventSafely({
    id: artifactId,
    type: ProfileInsightGenerated.name,
    metadata: {
      artifactId,
      version,
      promptVersion: PROFILE_INSIGHT_PROMPT_VERSION,
      provider: provider.name,
      model: result.model,
      userId,
    },
    occurredAt: generatedAt,
    confidence: 1,
    sourceLabel: "ai-layer",
    relatedEntityType: "user",
    relatedEntityId: userId,
    provenance: provenanceEventId ? [provenanceEventId] : [],
  });

  await db
    .insert(schema.profileInsight)
    .values({
      id: artifactId,
      userId,
      content,
      version,
      promptVersion: PROFILE_INSIGHT_PROMPT_VERSION,
      provider: provider.name,
      model: result.model,
      generatedAt,
    })
    .onConflictDoNothing({ target: schema.profileInsight.id });

  return {
    available: true,
    cached: false,
    artifact: {
      content,
      version,
      promptVersion: PROFILE_INSIGHT_PROMPT_VERSION,
      provider: provider.name,
      model: result.model,
      generatedAt,
    },
  };
}
