import { getDb, schema } from "@web3-hunter/db";
import { publishEventSafely } from "@web3-hunter/events";
import { deriveDeterministicId } from "@web3-hunter/shared";
import { and, desc, eq } from "drizzle-orm";
import { HiringSignalDetected } from "./event-types";
import type { RecentCompanyEvent, SignalCandidate } from "./types";

/**
 * Publishes a `HiringSignalDetected` Event for a detector's candidate,
 * then persists the structured `signal` row that mirrors it. The
 * Signal's ID is derived deterministically from its type and triggering
 * Event, not randomly generated, so re-running detection over an
 * already-processed Event recovers the same Signal instead of creating a
 * duplicate.
 *
 * Milestone 26 (real production audit — `event_provenance` was 107MB,
 * with `HiringSignalDetected` alone responsible for 45% of its rows,
 * averaging ~83 provenance citations per Signal). Root cause: two
 * detectors (`multipleRelatedOpeningsDetector`, `hiringVelocityDetector`
 * in `./detectors/hiring-detectors.ts`) cite a rolling N-day window of
 * JobPosted Events — and because a new Signal fires on every new
 * triggering Event while that window stays "hot," dozens of the same
 * job-posting Events get cited over and over by successive,
 * mostly-overlapping Signals as the window slides one Event at a time.
 *
 * The fix: cite only the Events *new* to this Signal's evidence since
 * the most recent previous Signal of the same type for this Company,
 * plus a link to that previous Signal's own Event — not the detector's
 * full candidate list every time. This is additive-only for full audit
 * reconstructability (walk the chain of previous-Signal links backward
 * to recover the complete original evidence trail) while making the
 * common case (a mostly-unchanged window) cost O(what's new) instead of
 * O(window size) in `event_provenance` rows. Detectors themselves are
 * unchanged — still pure, still cite their full candidate list — this
 * trims only what gets recorded as `event_provenance`; `signal.sourceEventIds`
 * (the product-facing column) still stores the detector's full,
 * untrimmed list, so nothing that reads it sees any behavior change.
 */
export async function persistSignal(
  candidate: SignalCandidate,
  triggeringEvent: RecentCompanyEvent,
  companyId: string,
): Promise<string> {
  const signalId = deriveDeterministicId(
    `web3-hunter:scoring:signal:${candidate.signalType}:${triggeringEvent.id}`,
  );

  const db = getDb();

  const [previousSignal] = await db
    .select({ id: schema.signal.id, sourceEventIds: schema.signal.sourceEventIds })
    .from(schema.signal)
    .where(
      and(
        eq(schema.signal.companyId, companyId),
        eq(schema.signal.signalType, candidate.signalType),
      ),
    )
    .orderBy(desc(schema.signal.id))
    .limit(1);

  const provenance = previousSignal
    ? [
        ...candidate.sourceEventIds.filter((id) => !previousSignal.sourceEventIds.includes(id)),
        previousSignal.id,
      ]
    : candidate.sourceEventIds;

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
    provenance,
  });

  await db
    .insert(schema.signal)
    .values({
      id: signalId,
      companyId,
      signalType: candidate.signalType,
      weight: candidate.weight,
      reasoning: candidate.reasoning,
      // Unchanged: the full, untrimmed candidate list — see doc comment.
      sourceEventIds: [...candidate.sourceEventIds],
      detectedAt: triggeringEvent.occurredAt,
    })
    .onConflictDoNothing({ target: schema.signal.id });

  return signalId;
}
