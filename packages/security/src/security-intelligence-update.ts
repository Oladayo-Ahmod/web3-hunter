import { getDb, schema } from "@web3-hunter/db";
import { publishEventSafely } from "@web3-hunter/events";
import { deriveDeterministicId } from "@web3-hunter/shared";
import { and, asc, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { SecurityIntelligenceUpdated } from "./event-types";
import {
  computeSecurityTargetIntelligence,
  securityIntelligenceStatesEqual,
} from "./security-intelligence";
import { upsertSecurityTargetIntelligence } from "./security-target-intelligence-store";
import type { SecuritySignalSummary, SecurityTargetIntelligenceState } from "./types";

const securityIntelligenceUpdatedMetadataSchema = z.object({
  signalCount: z.number().int().min(0),
});

/**
 * The most recent previous `SecurityIntelligenceUpdated` Event for this
 * Security Target, if any — mirrors
 * `company-intelligence-store.ts`'s `findPreviousIntelligenceUpdatedEvent`.
 */
async function findPreviousSecurityIntelligenceUpdatedEvent(
  securityTargetId: string,
): Promise<{ id: string; signalCount: number } | null> {
  const [row] = await getDb()
    .select({ id: schema.event.id, metadata: schema.event.metadata })
    .from(schema.event)
    .where(
      and(
        eq(schema.event.type, SecurityIntelligenceUpdated.name),
        eq(schema.event.relatedEntityType, "security_target"),
        eq(schema.event.relatedEntityId, securityTargetId),
      ),
    )
    .orderBy(desc(schema.event.occurredAt), desc(schema.event.id))
    .limit(1);

  if (!row) {
    return null;
  }

  const parsed = securityIntelligenceUpdatedMetadataSchema.safeParse(row.metadata);
  return parsed.success ? { id: row.id, signalCount: parsed.data.signalCount } : null;
}

async function getSecurityTargetSignals(
  securityTargetId: string,
): Promise<SecuritySignalSummary[]> {
  const rows = await getDb()
    .select()
    .from(schema.securitySignal)
    .where(eq(schema.securitySignal.securityTargetId, securityTargetId))
    .orderBy(asc(schema.securitySignal.detectedAt), asc(schema.securitySignal.id));

  return rows.map((row) => ({
    id: row.id,
    signalType: row.signalType,
    weight: row.weight,
    detectedAt: row.detectedAt,
  }));
}

async function currentProjection(
  securityTargetId: string,
): Promise<SecurityTargetIntelligenceState | null> {
  const [row] = await getDb()
    .select()
    .from(schema.securityTargetIntelligence)
    .where(eq(schema.securityTargetIntelligence.securityTargetId, securityTargetId))
    .limit(1);

  if (!row) {
    return null;
  }

  return {
    trend: row.trend,
    confidence: row.confidence,
    signalCount: row.signalCount,
    lastSignalAt: row.lastSignalAt,
  };
}

/**
 * Recomputes a Security Target's Intelligence as of `asOf` from its full
 * Signal history and, if it has meaningfully changed, publishes
 * `SecurityIntelligenceUpdated` *before* updating the projection — mirrors
 * `updateCompanyIntelligence` (`packages/scoring/src/company-intelligence-store.ts`)
 * exactly, including its provenance-trimming fix (cite only Signals new
 * since the most recent previous `SecurityIntelligenceUpdated`, plus a
 * link to that previous Event, rather than the full Signal history every
 * time). Returns the new state, or `null` if nothing meaningfully
 * changed (in which case nothing is published or written).
 */
export async function updateSecurityTargetIntelligence(
  securityTargetId: string,
  asOf: Date,
): Promise<SecurityTargetIntelligenceState | null> {
  const signals = await getSecurityTargetSignals(securityTargetId);
  const newState = computeSecurityTargetIntelligence(signals, asOf);
  const current = await currentProjection(securityTargetId);

  if (current && securityIntelligenceStatesEqual(current, newState)) {
    return null;
  }

  const eventId = deriveDeterministicId(
    `web3-hunter:security:intelligence-updated:${securityTargetId}:${asOf.toISOString()}:${signals.length}`,
  );

  const previousEvent = await findPreviousSecurityIntelligenceUpdatedEvent(securityTargetId);
  const provenance = previousEvent
    ? [...signals.slice(previousEvent.signalCount).map((signal) => signal.id), previousEvent.id]
    : signals.map((signal) => signal.id);

  await publishEventSafely({
    id: eventId,
    type: SecurityIntelligenceUpdated.name,
    metadata: {
      trend: newState.trend,
      confidence: newState.confidence,
      signalCount: newState.signalCount,
    },
    occurredAt: asOf,
    confidence: newState.confidence,
    sourceLabel: "security-engine",
    relatedEntityType: "security_target",
    relatedEntityId: securityTargetId,
    provenance,
  });

  await upsertSecurityTargetIntelligence({
    securityTargetId,
    trend: newState.trend,
    confidence: newState.confidence,
    signalCount: newState.signalCount,
    lastSignalAt: newState.lastSignalAt,
    asOf,
  });

  return newState;
}
