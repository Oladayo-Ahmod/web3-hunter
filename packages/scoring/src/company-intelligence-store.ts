import { getDb, schema } from "@web3-hunter/db";
import { publishEventSafely } from "@web3-hunter/events";
import { deriveDeterministicId } from "@web3-hunter/shared";
import { and, asc, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { IntelligenceUpdated } from "./event-types";
import { computeCompanyIntelligence, intelligenceStatesEqual } from "./intelligence";
import type { CompanyIntelligenceState, SignalSummary } from "./types";

const intelligenceUpdatedMetadataSchema = z.object({ signalCount: z.number().int().min(0) });

/**
 * The most recent previous `IntelligenceUpdated` Event for this Company,
 * if any — see `updateCompanyIntelligence`'s doc comment for why this
 * exists. Reads `metadata.signalCount` back out (validated defensively,
 * matching this codebase's convention for reading an Event's own
 * metadata rather than assuming its shape) to know how many of the
 * Company's signals that previous Event already covered.
 */
async function findPreviousIntelligenceUpdatedEvent(
  companyId: string,
): Promise<{ id: string; signalCount: number } | null> {
  const [row] = await getDb()
    .select({ id: schema.event.id, metadata: schema.event.metadata })
    .from(schema.event)
    .where(
      and(
        eq(schema.event.type, IntelligenceUpdated.name),
        eq(schema.event.relatedEntityType, "company"),
        eq(schema.event.relatedEntityId, companyId),
      ),
    )
    .orderBy(desc(schema.event.occurredAt), desc(schema.event.id))
    .limit(1);

  if (!row) {
    return null;
  }

  const parsed = intelligenceUpdatedMetadataSchema.safeParse(row.metadata);
  return parsed.success ? { id: row.id, signalCount: parsed.data.signalCount } : null;
}

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
 *
 * Milestone 26 (real production audit — `event_provenance` was 107MB,
 * with `IntelligenceUpdated` alone responsible for 46% of its rows,
 * averaging ~159 provenance citations per Event). Root cause: this
 * function re-cited a Company's *entire* Signal history as provenance on
 * every single recompute, and recomputes as often as once per new
 * Signal — so a Company with 150 accumulated Signals re-cited all 150 on
 * Signal #151, all 151 on #152, and so on: unbounded, compounding growth
 * with no relationship to how much actually changed.
 *
 * The fix: `computeCompanyIntelligence` still runs over the full Signal
 * history — the *state itself* (trend/confidence/signalCount) is a
 * product-correctness concern and stays exactly as accurate as before.
 * Only the *provenance citation* changes: instead of the full list, cite
 * the Signals new since the most recent previous `IntelligenceUpdated`
 * for this Company (identified via that Event's own `signalCount`,
 * since Signals are always appended in order) plus a link to that
 * previous Event. Full audit reconstructability is preserved
 * transitively — walk the chain of previous-Event links backward to
 * recover the complete original evidence trail — while the common case
 * (a handful of new Signals since last recompute) now costs O(what's
 * new) `event_provenance` rows instead of O(total Signal history).
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

  const previousEvent = await findPreviousIntelligenceUpdatedEvent(companyId);
  const provenance = previousEvent
    ? [...signals.slice(previousEvent.signalCount).map((signal) => signal.id), previousEvent.id]
    : signals.map((signal) => signal.id);

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
    provenance,
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
