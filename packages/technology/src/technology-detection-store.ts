import { getDb, schema } from "@web3-hunter/db";
import { publishEventSafely } from "@web3-hunter/events";
import { deriveDeterministicId } from "@web3-hunter/shared";
import { TechnologyDetected } from "./event-types";
import type { RecentCompanyEvent, TechnologyDetectionCandidate } from "./types";

/**
 * Publishes a `TechnologyDetected` Event for a detector's candidate, then
 * persists the structured `technology_detection` row that mirrors it —
 * the same "Event first, then projection" discipline `packages/scoring`'s
 * `persistSignal` and `packages/classification`'s `persistOpportunitySkill`
 * follow. The row's ID is derived deterministically from the Company,
 * Skill, and triggering Event, so re-running detection over already-
 * processed data recovers the same row instead of creating a duplicate.
 */
export async function persistTechnologyDetection(
  candidate: TechnologyDetectionCandidate,
  triggeringEvent: RecentCompanyEvent,
  companyId: string,
): Promise<string> {
  const id = deriveDeterministicId(
    `web3-hunter:technology:technology-detection:${companyId}:${candidate.skillId}:${triggeringEvent.id}`,
  );

  await publishEventSafely({
    id,
    type: TechnologyDetected.name,
    metadata: {
      companyId,
      skillId: candidate.skillId,
      confidence: candidate.confidence,
      reasoning: candidate.reasoning,
    },
    occurredAt: triggeringEvent.occurredAt,
    confidence: candidate.confidence,
    sourceLabel: "technology-engine",
    relatedEntityType: "company",
    relatedEntityId: companyId,
    provenance: candidate.sourceEventIds,
  });

  await getDb()
    .insert(schema.technologyDetection)
    .values({
      id,
      companyId,
      skillId: candidate.skillId,
      confidence: candidate.confidence,
      reasoning: candidate.reasoning,
      sourceEventIds: [...candidate.sourceEventIds],
      detectedAt: triggeringEvent.occurredAt,
    })
    .onConflictDoNothing({ target: schema.technologyDetection.id });

  return id;
}
