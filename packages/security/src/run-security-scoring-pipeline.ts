import { getDb, schema } from "@web3-hunter/db";
import { and, asc, eq, notExists } from "drizzle-orm";
import { listSecuritySignalDetectors } from "./registry";
import { updateSecurityTargetIntelligence } from "./security-intelligence-update";
import { evaluateSecurityOpportunity } from "./security-opportunity-evaluation";
import { recordSecuritySignal } from "./security-signal-generation";
import type { RecentSecurityTargetEvent, SecuritySignalDetectionContext } from "./types";

export interface SecurityScoringPipelineResult {
  eventsProcessed: number;
  signalsProduced: number;
  intelligenceUpdates: number;
  opportunitiesDetected: number;
}

function toRecentSecurityTargetEvent(row: {
  id: string;
  type: string;
  occurredAt: Date;
  metadata: unknown;
}): RecentSecurityTargetEvent {
  return { id: row.id, type: row.type, occurredAt: row.occurredAt, metadata: row.metadata };
}

/**
 * The Signal -> Security Target Intelligence -> Opportunity Detection
 * orchestration for one Security Target — mirrors `runScoringPipeline`
 * (`packages/scoring/src/run-scoring-pipeline.ts`) exactly, scoped to
 * `security_target` Source Events instead of `company` ones, and with no
 * scoring step (see `security-opportunity-evaluation.ts`'s doc comment).
 *
 * Idempotent and safe to call repeatedly: `security_signal_generation_ledger`
 * tracks which Events have already been run through detection (the same
 * pattern as `packages/ingestion`'s `raw_record_ingestion`), and every
 * Event this function publishes has a deterministic ID, so replaying the
 * same history reproduces identical Signals, Intelligence, and
 * Opportunities rather than duplicating them.
 */
export async function runSecurityScoringPipeline(
  securityTargetId: string,
): Promise<SecurityScoringPipelineResult> {
  const db = getDb();

  const unprocessed = await db
    .select()
    .from(schema.event)
    .where(
      and(
        eq(schema.event.relatedEntityType, "security_target"),
        eq(schema.event.relatedEntityId, securityTargetId),
        eq(schema.event.category, "source"),
        notExists(
          db
            .select()
            .from(schema.securitySignalGenerationLedger)
            .where(eq(schema.securitySignalGenerationLedger.eventId, schema.event.id)),
        ),
      ),
    )
    .orderBy(asc(schema.event.occurredAt), asc(schema.event.id));

  const result: SecurityScoringPipelineResult = {
    eventsProcessed: unprocessed.length,
    signalsProduced: 0,
    intelligenceUpdates: 0,
    opportunitiesDetected: 0,
  };

  if (unprocessed.length === 0) {
    return result;
  }

  const allSourceEvents = await db
    .select()
    .from(schema.event)
    .where(
      and(
        eq(schema.event.relatedEntityType, "security_target"),
        eq(schema.event.relatedEntityId, securityTargetId),
        eq(schema.event.category, "source"),
      ),
    )
    .orderBy(asc(schema.event.occurredAt), asc(schema.event.id));

  for (const triggeringEvent of unprocessed) {
    const historyRows = allSourceEvents.filter(
      (event) => event.occurredAt.getTime() <= triggeringEvent.occurredAt.getTime(),
    );

    const triggering = toRecentSecurityTargetEvent(triggeringEvent);
    const context: SecuritySignalDetectionContext = {
      securityTargetId,
      asOf: triggeringEvent.occurredAt,
      recentEvents: historyRows.map(toRecentSecurityTargetEvent),
    };

    const candidates = listSecuritySignalDetectors().flatMap((detector) =>
      detector(triggering, context),
    );

    for (const candidate of candidates) {
      await recordSecuritySignal(candidate, triggering, securityTargetId);
      result.signalsProduced += 1;
    }

    await db
      .insert(schema.securitySignalGenerationLedger)
      .values({ eventId: triggeringEvent.id, signalsProduced: candidates.length })
      .onConflictDoNothing({ target: schema.securitySignalGenerationLedger.eventId });

    if (candidates.length === 0) {
      continue;
    }

    const newIntelligence = await updateSecurityTargetIntelligence(
      securityTargetId,
      triggeringEvent.occurredAt,
    );
    if (!newIntelligence) {
      continue;
    }
    result.intelligenceUpdates += 1;

    const opportunityResult = await evaluateSecurityOpportunity(
      securityTargetId,
      newIntelligence,
      triggeringEvent.occurredAt,
    );
    if (opportunityResult?.detected) {
      result.opportunitiesDetected += 1;
    }
  }

  return result;
}
