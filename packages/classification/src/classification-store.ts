import { getDb, schema } from "@web3-hunter/db";
import { publishEventSafely } from "@web3-hunter/events";
import { deriveDeterministicId } from "@web3-hunter/shared";
import { JobSkillDetected, OpportunitySkillDetected } from "./event-types";
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

/**
 * Publishes a `JobSkillDetected` Event for a classifier's candidate, then
 * persists the structured `job_skill` row that mirrors it —
 * `persistOpportunitySkill`'s job-granularity counterpart (Milestone 13
 * Phase 2), same "Event first, then projection" discipline. The row's ID
 * is derived deterministically from the Job (`companyId` + `externalId`),
 * the Skill, and the triggering Event, so re-running Job classification
 * over already-processed data recovers the same row instead of creating a
 * duplicate.
 */
export async function persistJobSkill(
  candidate: SkillClassificationCandidate,
  triggeringEvent: RecentCompanyEvent,
  companyId: string,
  externalId: string,
): Promise<string> {
  const id = deriveDeterministicId(
    `web3-hunter:classification:job-skill:${companyId}:${externalId}:${candidate.skillId}:${triggeringEvent.id}`,
  );

  await publishEventSafely({
    id,
    type: JobSkillDetected.name,
    metadata: {
      companyId,
      externalId,
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
    .insert(schema.jobSkill)
    .values({
      id,
      companyId,
      externalId,
      skillId: candidate.skillId,
      confidence: candidate.confidence,
      reasoning: candidate.reasoning,
      sourceEventIds: [...candidate.sourceEventIds],
      detectedAt: triggeringEvent.occurredAt,
    })
    .onConflictDoNothing({
      target: [schema.jobSkill.companyId, schema.jobSkill.externalId, schema.jobSkill.skillId],
    });

  return id;
}
