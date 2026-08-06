import { getDb, schema } from "@web3-hunter/db";
import { and, asc, eq, notExists } from "drizzle-orm";
import { persistOpportunitySkill } from "./classification-store";
import { listSkillClassifiers } from "./registry";
import type { ClassificationContext, RecentCompanyEvent } from "./types";

export interface ClassificationPipelineResult {
  eventsProcessed: number;
  classificationsProduced: number;
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
 * Derives structured metadata (Skills today) for one Opportunity, per
 * docs/ROADMAP.md Milestone 5: finds its Company's not-yet-classified
 * Source Events, runs every registered Skill Classifier against each, and
 * persists any resulting `opportunity_skill` rows.
 *
 * Scoped by Opportunity, not just Company — unlike Signal generation,
 * classification output (`opportunity_skill`) is Opportunity-specific, so
 * `classification_ledger` tracks "this Event has been classified for this
 * Opportunity" rather than "this Event has been classified" globally.
 * Idempotent and safe to call repeatedly for the same reason
 * `runScoringPipeline` is: deterministic IDs plus a ledger of already-
 * processed work.
 */
export async function runClassificationPipeline(
  opportunityId: string,
): Promise<ClassificationPipelineResult> {
  const db = getDb();

  const [opportunityRow] = await db
    .select()
    .from(schema.opportunity)
    .where(eq(schema.opportunity.id, opportunityId))
    .limit(1);

  if (!opportunityRow) {
    throw new Error(`Opportunity "${opportunityId}" not found.`);
  }

  const skills = await db.select().from(schema.skill);
  const context: ClassificationContext = { skills };

  const unprocessed = await db
    .select()
    .from(schema.event)
    .where(
      and(
        eq(schema.event.relatedEntityType, "company"),
        eq(schema.event.relatedEntityId, opportunityRow.companyId),
        eq(schema.event.category, "source"),
        notExists(
          db
            .select()
            .from(schema.classificationLedger)
            .where(
              and(
                eq(schema.classificationLedger.opportunityId, opportunityId),
                eq(schema.classificationLedger.eventId, schema.event.id),
              ),
            ),
        ),
      ),
    )
    .orderBy(asc(schema.event.occurredAt), asc(schema.event.id));

  const result: ClassificationPipelineResult = {
    eventsProcessed: unprocessed.length,
    classificationsProduced: 0,
  };

  // Deferred and inserted once, batched, after the loop below - instead of
  // one awaited insert per Event - since against a remote database this
  // was the dominant cost: most Events produce zero classifications (pure
  // ledger bookkeeping), so this was N sequential round-trips for what's
  // fundamentally one piece of work. Trade-off, disclosed rather than
  // silent: if this function throws partway through the loop, none of
  // this batch's ledger rows are persisted, not even for Events already
  // successfully classified - unlike before, where each row was durable
  // the moment its Event finished. That only costs redundant, idempotent
  // reprocessing on the next run (deterministic IDs + onConflictDoNothing
  // throughout this codebase mean it recovers the same rows, not
  // duplicates) - never lost or incorrect data.
  const ledgerRows: (typeof schema.classificationLedger.$inferInsert)[] = [];

  for (const eventRow of unprocessed) {
    const triggeringEvent = toRecentCompanyEvent(eventRow);
    const candidates = listSkillClassifiers().flatMap((classifier) =>
      classifier(triggeringEvent, context),
    );

    for (const candidate of candidates) {
      await persistOpportunitySkill(
        candidate,
        triggeringEvent,
        opportunityId,
        opportunityRow.companyId,
      );
      result.classificationsProduced += 1;
    }

    ledgerRows.push({
      opportunityId,
      eventId: eventRow.id,
      classificationsProduced: candidates.length,
    });
  }

  if (ledgerRows.length > 0) {
    await db
      .insert(schema.classificationLedger)
      .values(ledgerRows)
      .onConflictDoNothing({
        target: [schema.classificationLedger.opportunityId, schema.classificationLedger.eventId],
      });
  }

  return result;
}
