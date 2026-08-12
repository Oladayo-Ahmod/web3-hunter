import { sql } from "drizzle-orm";
import {
  check,
  doublePrecision,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { company } from "./company";
import { event } from "./event";
import { skill } from "./skill";

/**
 * A structured, explainable fact about an individual Job — the
 * job-granularity counterpart to `opportunity_skill` (Milestone 5), added
 * Milestone 13 Phase 2 because Job relevance (`packages/application/src
 * /job-relevance.ts`) needs to know what a *specific job* is about, not
 * just what a Company's aggregate hiring activity is about. Same
 * evidentiary discipline: `id` is shared with the `JobSkillDetected`
 * Event that recorded its detection, and it's append-only.
 *
 * A Job has no database row of its own (it's a read-time projection over
 * the Event log — see `job-query-service.ts`'s doc comment), so its
 * identity here is the same `(companyId, externalId)` pair that
 * identifies it everywhere else in the system, not a foreign key to a
 * `job` table that doesn't exist.
 */
export const jobSkill = pgTable(
  "job_skill",
  {
    id: uuid("id").primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => company.id),
    externalId: text("external_id").notNull(),
    skillId: uuid("skill_id")
      .notNull()
      .references(() => skill.id),
    confidence: doublePrecision("confidence").notNull(),
    reasoning: text("reasoning").notNull(),
    sourceEventIds: uuid("source_event_ids").array().notNull(),
    detectedAt: timestamp("detected_at", { withTimezone: true }).notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("job_skill_confidence_range", sql`${table.confidence} >= 0 AND ${table.confidence} <= 1`),
    unique("job_skill_company_id_external_id_skill_id_key").on(
      table.companyId,
      table.externalId,
      table.skillId,
    ),
    index("job_skill_company_id_external_id_idx").on(table.companyId, table.externalId),
  ],
);

/**
 * The ledger of which `JobPosted` Events have been run through Job
 * classification — the same "unprocessed work" pattern
 * `classification_ledger` uses, but keyed by Event alone rather than
 * `(opportunityId, eventId)`: Job classification isn't Opportunity-scoped
 * (a Job doesn't need an Opportunity to exist to be classified — see
 * `run-job-classification-pipeline.ts`), so one Event unambiguously maps
 * to at most one ledger row.
 */
export const jobClassificationLedger = pgTable("job_classification_ledger", {
  eventId: uuid("event_id")
    .primaryKey()
    .references(() => event.id),
  classificationsProduced: integer("classifications_produced").notNull().default(0),
  processedAt: timestamp("processed_at", { withTimezone: true }).notNull().defaultNow(),
});
