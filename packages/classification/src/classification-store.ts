import { getDb, schema } from "@web3-hunter/db";
import { publishEventSafely } from "@web3-hunter/events";
import { deriveDeterministicId } from "@web3-hunter/shared";
import { OpportunitySkillDetected } from "./event-types";
import type { RecentCompanyEvent, SkillClassificationCandidate } from "./types";

/**
 * Publishes an `OpportunitySkillDetected` Event for a classifier's
 * candidate, then persists the structured `opportunity_skill` row that
 * mirrors it — the same "Event first, then projection" discipline
 * `packages/scoring`'s `persistSignal` follows. The row's ID is derived
 * deterministically from the Opportunity, Skill, and triggering Event, so
 * re-running classification over already-processed data recovers the same
 * row instead of creating a duplicate.
 */
export async function persistOpportunitySkill(
  candidate: SkillClassificationCandidate,
  triggeringEvent: RecentCompanyEvent,
  opportunityId: string,
  companyId: string,
): Promise<string> {
  const id = deriveDeterministicId(
    `web3-hunter:classification:opportunity-skill:${opportunityId}:${candidate.skillId}:${triggeringEvent.id}`,
  );

  await publishEventSafely({
    id,
    type: OpportunitySkillDetected.name,
    metadata: {
      opportunityId,
      skillId: candidate.skillId,
      confidence: candidate.confidence,
      reasoning: candidate.reasoning,
    },
    occurredAt: triggeringEvent.occurredAt,
    confidence: candidate.confidence,
    sourceLabel: "classification-engine",
    relatedEntityType: "company",
    relatedEntityId: companyId,
    provenance: candidate.sourceEventIds,
  });

  await getDb()
    .insert(schema.opportunitySkill)
    .values({
      id,
      opportunityId,
      skillId: candidate.skillId,
      confidence: candidate.confidence,
      reasoning: candidate.reasoning,
      sourceEventIds: [...candidate.sourceEventIds],
      detectedAt: triggeringEvent.occurredAt,
    })
    .onConflictDoNothing({
      target: [schema.opportunitySkill.opportunityId, schema.opportunitySkill.skillId],
    });

  return id;
}
