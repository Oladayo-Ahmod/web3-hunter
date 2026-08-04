import { getDb, schema } from "@web3-hunter/db";
import { publishEventSafely } from "@web3-hunter/events";
import { deriveDeterministicId } from "@web3-hunter/shared";
import { HiringSignalDetected } from "./event-types";
import type { RecentCompanyEvent, SignalCandidate } from "./types";

/**
 * Publishes a `HiringSignalDetected` Event for a detector's candidate,
 * then persists the structured `signal` row that mirrors it. The
 * Signal's ID is derived deterministically from its type and triggering
 * Event, not randomly generated, so re-running detection over an
 * already-processed Event recovers the same Signal instead of creating a
 * duplicate.
 */
export async function persistSignal(
  candidate: SignalCandidate,
  triggeringEvent: RecentCompanyEvent,
  companyId: string,
): Promise<string> {
  const signalId = deriveDeterministicId(
    `web3-hunter:scoring:signal:${candidate.signalType}:${triggeringEvent.id}`,
  );

  await publishEventSafely({
    id: signalId,
    type: HiringSignalDetected.name,
    metadata: {
      signalType: candidate.signalType,
      weight: candidate.weight,
      reasoning: candidate.reasoning,
    },
    occurredAt: triggeringEvent.occurredAt,
    confidence: candidate.weight,
    sourceLabel: "scoring-engine",
    relatedEntityType: "company",
    relatedEntityId: companyId,
    provenance: candidate.sourceEventIds,
  });

  await getDb()
    .insert(schema.signal)
    .values({
      id: signalId,
      companyId,
      signalType: candidate.signalType,
      weight: candidate.weight,
      reasoning: candidate.reasoning,
      sourceEventIds: [...candidate.sourceEventIds],
      detectedAt: triggeringEvent.occurredAt,
    })
    .onConflictDoNothing({ target: schema.signal.id });

  return signalId;
}
