import { getDb, schema } from "@web3-hunter/db";
import { deriveDeterministicId } from "@web3-hunter/shared";
import { asc, eq } from "drizzle-orm";
import { IntelligenceUpdated } from "./event-types";
import { computeCompanyIntelligence, intelligenceStatesEqual } from "./intelligence";
import { publishEventSafely } from "./publish-safely";
import type { CompanyIntelligenceState, SignalSummary } from "./types";

async function getCompanySignals(companyId: string): Promise<SignalSummary[]> {
  const rows = await getDb()
    .select()
    .from(schema.signal)
    .where(eq(schema.signal.companyId, companyId))
    .orderBy(asc(schema.signal.detectedAt), asc(schema.signal.id));

  return rows.map((row) => ({
    id: row.id,
    signalType: row.signalType,
    weight: row.weight,
    detectedAt: row.detectedAt,
  }));
}

async function currentProjection(companyId: string): Promise<CompanyIntelligenceState | null> {
  const [row] = await getDb()
    .select()
    .from(schema.companyIntelligence)
    .where(eq(schema.companyIntelligence.companyId, companyId))
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

async function upsertProjection(
  companyId: string,
  state: CompanyIntelligenceState,
  asOf: Date,
): Promise<void> {
  await getDb()
    .insert(schema.companyIntelligence)
    .values({
      companyId,
      trend: state.trend,
      confidence: state.confidence,
      signalCount: state.signalCount,
      lastSignalAt: state.lastSignalAt,
      asOf,
    })
    .onConflictDoUpdate({
      target: schema.companyIntelligence.companyId,
      set: {
        trend: state.trend,
        confidence: state.confidence,
        signalCount: state.signalCount,
        lastSignalAt: state.lastSignalAt,
        asOf,
        updatedAt: new Date(),
      },
    });
}

/**
 * Recomputes a Company's Intelligence as of `asOf` from its full Signal
 * history and, if it has meaningfully changed, publishes
 * `IntelligenceUpdated` *before* updating the projection — per the
 * approved Milestone 3 refinement. Returns the new state, or `null` if
 * nothing meaningfully changed (in which case nothing is published or
 * written).
 */
export async function updateCompanyIntelligence(
  companyId: string,
  asOf: Date,
): Promise<CompanyIntelligenceState | null> {
  const signals = await getCompanySignals(companyId);
  const newState = computeCompanyIntelligence(signals, asOf);
  const current = await currentProjection(companyId);

  if (current && intelligenceStatesEqual(current, newState)) {
    return null;
  }

  const eventId = deriveDeterministicId(
    `web3-hunter:scoring:intelligence-updated:${companyId}:${asOf.toISOString()}:${signals.length}`,
  );

  await publishEventSafely({
    id: eventId,
    type: IntelligenceUpdated.name,
    metadata: {
      trend: newState.trend,
      confidence: newState.confidence,
      signalCount: newState.signalCount,
    },
    occurredAt: asOf,
    confidence: newState.confidence,
    sourceLabel: "scoring-engine",
    relatedEntityType: "company",
    relatedEntityId: companyId,
    provenance: signals.map((signal) => signal.id),
  });

  await upsertProjection(companyId, newState, asOf);

  return newState;
}

/**
 * Rebuilds a Company's Intelligence projection purely by replaying its
 * Signal history, proving the projection is genuinely derived rather than
 * an independent source of truth (docs/DATABASE.md §1). Does not publish
 * `IntelligenceUpdated`: rebuilding restates already-published history,
 * it doesn't create a new fact.
 */
export async function rebuildCompanyIntelligence(
  companyId: string,
  asOf: Date,
): Promise<CompanyIntelligenceState> {
  const signals = await getCompanySignals(companyId);
  const state = computeCompanyIntelligence(signals, asOf);

  await upsertProjection(companyId, state, asOf);

  return state;
}
