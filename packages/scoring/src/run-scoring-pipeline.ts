import { getDb, schema } from "@web3-hunter/db";
import { and, asc, eq, lte, notExists } from "drizzle-orm";
import { updateCompanyIntelligence } from "./company-intelligence-store";
import { evaluateOpportunity } from "./opportunity-store";
import { listSignalDetectors } from "./registry";
import { persistSignal } from "./signal-generation";
import type { RecentCompanyEvent, SignalDetectionContext } from "./types";

export interface ScoringPipelineResult {
  eventsProcessed: number;
  signalsProduced: number;
  intelligenceUpdates: number;
  opportunitiesDetected: number;
  opportunitiesScored: number;
}

function toRecentCompanyEvent(row: {
  id: string;
  type: string;
  occurredAt: Date;
  metadata: unknown;
}): RecentCompanyEvent {
  return { id: row.id, type: row.type, occurredAt: row.occurredAt, metadata: row.metadata };
}

/**
 * The Signal -> Company Intelligence -> Opportunity Detection
 * orchestration for one Company, per docs/ROADMAP.md Milestone 3: finds
 * its not-yet-processed Source Events, runs every registered Signal
 * detector against each with the historical context detectors need,
 * persists any Signals, recomputes Company Intelligence when Signals
 * changed, and evaluates Opportunity detection/scoring when Intelligence
 * changed.
 *
 * Events are processed in `occurredAt` order, and Opportunities are
 * evaluated after *each* Intelligence change, not only once at the end —
 * otherwise replaying a long history in one call would only ever evaluate
 * the final Detection Window, silently skipping earlier ones.
 *
 * Idempotent and safe to call repeatedly: `signal_generation_ledger`
 * tracks which Events have already been run through detection (the same
 * pattern as `packages/ingestion`'s `raw_record_ingestion`), and every
 * Event this function publishes has a deterministic ID, so replaying the
 * same history reproduces identical Signals, Intelligence, Opportunities,
 * and Scores rather than duplicating them.
 */
export async function runScoringPipeline(companyId: string): Promise<ScoringPipelineResult> {
  const db = getDb();

  const unprocessed = await db
    .select()
    .from(schema.event)
    .where(
      and(
        eq(schema.event.relatedEntityType, "company"),
        eq(schema.event.relatedEntityId, companyId),
        eq(schema.event.category, "source"),
        notExists(
          db
            .select()
            .from(schema.signalGenerationLedger)
            .where(eq(schema.signalGenerationLedger.eventId, schema.event.id)),
        ),
      ),
    )
    .orderBy(asc(schema.event.occurredAt), asc(schema.event.id));

  const result: ScoringPipelineResult = {
    eventsProcessed: unprocessed.length,
    signalsProduced: 0,
    intelligenceUpdates: 0,
    opportunitiesDetected: 0,
    opportunitiesScored: 0,
  };

  for (const triggeringEvent of unprocessed) {
    const historyRows = await db
      .select()
      .from(schema.event)
      .where(
        and(
          eq(schema.event.relatedEntityType, "company"),
          eq(schema.event.relatedEntityId, companyId),
          eq(schema.event.category, "source"),
          lte(schema.event.occurredAt, triggeringEvent.occurredAt),
        ),
      )
      .orderBy(asc(schema.event.occurredAt), asc(schema.event.id));

    const triggering = toRecentCompanyEvent(triggeringEvent);
    const context: SignalDetectionContext = {
      companyId,
      asOf: triggeringEvent.occurredAt,
      recentEvents: historyRows.map(toRecentCompanyEvent),
    };

    const candidates = listSignalDetectors().flatMap((detector) => detector(triggering, context));

    for (const candidate of candidates) {
      await persistSignal(candidate, triggering, companyId);
      result.signalsProduced += 1;
    }

    await db
      .insert(schema.signalGenerationLedger)
      .values({ eventId: triggeringEvent.id, signalsProduced: candidates.length })
      .onConflictDoNothing({ target: schema.signalGenerationLedger.eventId });

    if (candidates.length === 0) {
      continue;
    }

    const newIntelligence = await updateCompanyIntelligence(companyId, triggeringEvent.occurredAt);
    if (!newIntelligence) {
      continue;
    }
    result.intelligenceUpdates += 1;

    const opportunityResult = await evaluateOpportunity(
      companyId,
      newIntelligence,
      triggeringEvent.occurredAt,
    );
    if (opportunityResult?.detected) {
      result.opportunitiesDetected += 1;
    }
    if (opportunityResult?.scored) {
      result.opportunitiesScored += 1;
    }
  }

  return result;
}
