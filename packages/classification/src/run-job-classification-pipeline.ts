import { getDb, schema } from "@web3-hunter/db";
import { and, asc, eq, notExists } from "drizzle-orm";
import { z } from "zod";
import { persistJobSkill } from "./classification-store";
import { listSkillClassifiers } from "./registry";
import type { ClassificationContext, RecentCompanyEvent } from "./types";

export interface JobClassificationPipelineResult {
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

// Only `externalId` is actually needed here — everything else a
// classifier reads it parses itself (see `skillKeywordClassifier`).
const jobEventExternalIdSchema = z.object({ externalId: z.string() });

/**
 * Derives structured metadata (Skills today) for one Company's individual
 * Jobs, per Milestone 13 Phase 2 — the job-granularity counterpart to
 * `runClassificationPipeline`. Reuses the exact same registered
 * `SkillClassifier`s (`skillKeywordClassifier` included) against the same
 * `JobPosted` Events; the only difference is what the result is persisted
 * against: `job_skill` keyed by `(companyId, externalId)`, not
 * `opportunity_skill` keyed by `opportunityId`.
 *
 * Company-scoped rather than Opportunity-scoped, deliberately: a Job
 * doesn't need its Company to have an Opportunity (a hiring-surge
 * detection) to be classifiable — most Companies in the directory never
 * will, and their Jobs still need relevance-scoring skill tags. This
 * mirrors why `runTechnologyPipeline` is Company-scoped rather than
 * Opportunity-scoped, for the same reason.
 *
 * Only processes `JobPosted` Events — `skillKeywordClassifier` itself
 * already ignores everything else (see its own guard), so a title change
 * via `JobUpdated` doesn't currently re-trigger classification. The same
 * limitation `runClassificationPipeline` already has; not solved here,
 * not silently different either.
 */
export async function runJobClassificationPipeline(
  companyId: string,
): Promise<JobClassificationPipelineResult> {
  const db = getDb();

  const skills = await db.select().from(schema.skill);
  const context: ClassificationContext = { skills };

  const unprocessed = await db
    .select()
    .from(schema.event)
    .where(
      and(
        eq(schema.event.relatedEntityType, "company"),
        eq(schema.event.relatedEntityId, companyId),
        eq(schema.event.type, "JobPosted"),
        notExists(
          db
            .select()
            .from(schema.jobClassificationLedger)
            .where(eq(schema.jobClassificationLedger.eventId, schema.event.id)),
        ),
      ),
    )
    .orderBy(asc(schema.event.occurredAt), asc(schema.event.id));

  const result: JobClassificationPipelineResult = {
    eventsProcessed: unprocessed.length,
    classificationsProduced: 0,
  };

  const ledgerRows: (typeof schema.jobClassificationLedger.$inferInsert)[] = [];

  for (const eventRow of unprocessed) {
    const parsedExternalId = jobEventExternalIdSchema.safeParse(eventRow.metadata);
    if (!parsedExternalId.success) {
      // Defensive, not expected: every `JobPosted` Event's metadata is
      // `JobFields`, which always has `externalId` (see
      // `packages/collectors/src/hiring-events.ts`). Skip rather than
      // throw, the same "decline, don't crash the whole run" discipline
      // `skillKeywordClassifier` itself follows for a malformed Event.
      ledgerRows.push({ eventId: eventRow.id, classificationsProduced: 0 });
      continue;
    }

    const triggeringEvent = toRecentCompanyEvent(eventRow);
    const candidates = listSkillClassifiers().flatMap((classifier) =>
      classifier(triggeringEvent, context),
    );

    for (const candidate of candidates) {
      await persistJobSkill(
        candidate,
        triggeringEvent,
        companyId,
        parsedExternalId.data.externalId,
      );
      result.classificationsProduced += 1;
    }

    ledgerRows.push({ eventId: eventRow.id, classificationsProduced: candidates.length });
  }

  if (ledgerRows.length > 0) {
    await db
      .insert(schema.jobClassificationLedger)
      .values(ledgerRows)
      .onConflictDoNothing({ target: schema.jobClassificationLedger.eventId });
  }

  return result;
}
