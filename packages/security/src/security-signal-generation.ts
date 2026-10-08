import { getDb, schema } from "@web3-hunter/db";
import { publishEventSafely } from "@web3-hunter/events";
import { deriveDeterministicId } from "@web3-hunter/shared";
import { and, desc, eq } from "drizzle-orm";
import { SecuritySignalDetected } from "./event-types";
import { persistSecuritySignal } from "./security-signal-store";
import type { RecentSecurityTargetEvent, SecuritySignalCandidate } from "./types";

/**
 * Publishes a `SecuritySignalDetected` Event for a detector's candidate,
 * then persists the structured `security_signal` row that mirrors it —
 * mirrors `persistSignal` (`packages/scoring/src/signal-generation.ts`)
 * exactly, including its provenance-trimming fix: `event_provenance`
 * cites only the Events new to this Signal's evidence since the most
 * recent previous Signal of the same type for this Security Target, plus
 * a link to that previous Signal, rather than the detector's full
 * candidate list every time. `security_signal.sourceEventIds` (the
 * product-facing column) still stores the full, untrimmed list.
 */
export async function recordSecuritySignal(
  candidate: SecuritySignalCandidate,
  triggeringEvent: RecentSecurityTargetEvent,
  securityTargetId: string,
): Promise<string> {
  const signalId = deriveDeterministicId(
    `web3-hunter:security:signal:${candidate.signalType}:${triggeringEvent.id}`,
  );

  const db = getDb();

  const [previousSignal] = await db
    .select({ id: schema.securitySignal.id, sourceEventIds: schema.securitySignal.sourceEventIds })
    .from(schema.securitySignal)
    .where(
      and(
        eq(schema.securitySignal.securityTargetId, securityTargetId),
        eq(schema.securitySignal.signalType, candidate.signalType),
      ),
    )
    .orderBy(desc(schema.securitySignal.id))
    .limit(1);

  const provenance = previousSignal
    ? [
        ...candidate.sourceEventIds.filter((id) => !previousSignal.sourceEventIds.includes(id)),
        previousSignal.id,
      ]
    : candidate.sourceEventIds;

  await publishEventSafely({
    id: signalId,
    type: SecuritySignalDetected.name,
    metadata: {
      signalType: candidate.signalType,
      weight: candidate.weight,
      reasoning: candidate.reasoning,
    },
    occurredAt: triggeringEvent.occurredAt,
    confidence: candidate.weight,
    sourceLabel: "security-engine",
    relatedEntityType: "security_target",
    relatedEntityId: securityTargetId,
    provenance,
  });

  await persistSecuritySignal({
    id: signalId,
    securityTargetId,
    signalType: candidate.signalType,
    weight: candidate.weight,
    reasoning: candidate.reasoning,
    sourceEventIds: [...candidate.sourceEventIds],
    detectedAt: triggeringEvent.occurredAt,
  });

  return signalId;
}
