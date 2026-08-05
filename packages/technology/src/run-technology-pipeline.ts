import { getDb, schema } from "@web3-hunter/db";
import { and, asc, eq, notExists } from "drizzle-orm";
import { updateCompanyTechnologyProfile } from "./company-technology-profile-store";
import { listTechnologyDetectors } from "./registry";
import { persistTechnologyDetection } from "./technology-detection-store";
import type { RecentCompanyEvent, TechnologyDetectionContext } from "./types";

export interface TechnologyPipelineResult {
  eventsProcessed: number;
  detectionsProduced: number;
  profileUpdated: boolean;
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
 * The Technology Detection -> Company Technology Profile orchestration
 * for one Company, per docs/ROADMAP.md Milestone 9: finds its not-yet-
 * processed Source Events, runs every registered Technology Detector
 * against each, persists any detections, and recomputes the Company
 * Technology Profile when detections changed.
 *
 * Deliberately processes *every* Source Event for the Company, the same
 * way `packages/scoring`'s `runScoringPipeline` does — including ones no
 * Technology Detector cares about (e.g. `JobPosted`), which simply
 * produce zero detections. This is what keeps `packages/scoring`
 * genuinely unmodified: the two pipelines read the same Source Event
 * stream independently, each ignoring what isn't theirs, rather than one
 * routing events to the other.
 *
 * Idempotent and safe to call repeatedly: `technology_detection_ledger`
 * tracks which Events have already been run through detection, and every
 * Event this function publishes has a deterministic ID, so replaying the
 * same history reproduces identical detections and profiles rather than
 * duplicating them.
 */
export async function runTechnologyPipeline(companyId: string): Promise<TechnologyPipelineResult> {
  const db = getDb();

  const skills = await db.select().from(schema.skill);
  const context: TechnologyDetectionContext = { skills };

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
            .from(schema.technologyDetectionLedger)
            .where(eq(schema.technologyDetectionLedger.eventId, schema.event.id)),
        ),
      ),
    )
    .orderBy(asc(schema.event.occurredAt), asc(schema.event.id));

  const result: TechnologyPipelineResult = {
    eventsProcessed: unprocessed.length,
    detectionsProduced: 0,
    profileUpdated: false,
  };

  let latestOccurredAt: Date | null = null;

  for (const eventRow of unprocessed) {
    const triggeringEvent = toRecentCompanyEvent(eventRow);
    const candidates = listTechnologyDetectors().flatMap((detector) =>
      detector(triggeringEvent, context),
    );

    for (const candidate of candidates) {
      await persistTechnologyDetection(candidate, triggeringEvent, companyId);
      result.detectionsProduced += 1;
    }

    await db
      .insert(schema.technologyDetectionLedger)
      .values({ eventId: eventRow.id, technologiesDetected: candidates.length })
      .onConflictDoNothing({ target: schema.technologyDetectionLedger.eventId });

    if (candidates.length > 0) {
      latestOccurredAt = triggeringEvent.occurredAt;
    }
  }

  if (latestOccurredAt) {
    const updated = await updateCompanyTechnologyProfile(companyId, latestOccurredAt);
    result.profileUpdated = updated !== null;
  }

  return result;
}
