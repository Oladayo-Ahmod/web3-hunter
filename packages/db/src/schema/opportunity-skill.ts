import { sql } from "drizzle-orm";
import {
  check,
  doublePrecision,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { event } from "./event";
import { opportunity } from "./opportunity";
import { skill } from "./skill";

/**
 * A structured, explainable fact about an Opportunity, derived by
 * `packages/classification` from its underlying Source Events — the same
 * evidentiary discipline `packages/scoring` applies to Signals. `id` is
 * shared with the `OpportunitySkillDetected` Event that recorded its
 * detection (see `packages/classification`), mirroring `signal`'s
 * relationship to `HiringSignalDetected`.
 *
 * Append-only: a classification's detection is an immutable historical
 * fact, same as `signal` (docs/DATABASE.md §2).
 */
export const opportunitySkill = pgTable(
  "opportunity_skill",
  {
    id: uuid("id").primaryKey(),
    opportunityId: uuid("opportunity_id")
      .notNull()
      .references(() => opportunity.id),
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
    check(
      "opportunity_skill_confidence_range",
      sql`${table.confidence} >= 0 AND ${table.confidence} <= 1`,
    ),
    unique("opportunity_skill_opportunity_id_skill_id_key").on(table.opportunityId, table.skillId),
    index("opportunity_skill_opportunity_id_idx").on(table.opportunityId),
  ],
);

/**
 * The ledger of which Source Events have been run through classification
 * for a given Opportunity — the same "unprocessed work" pattern as
 * `signal_generation_ledger`, scoped additionally by Opportunity since
 * classification output (unlike Signal generation) is Opportunity-scoped,
 * not just Company-scoped.
 */
export const classificationLedger = pgTable(
  "classification_ledger",
  {
    opportunityId: uuid("opportunity_id")
      .notNull()
      .references(() => opportunity.id),
    eventId: uuid("event_id")
      .notNull()
      .references(() => event.id),
    classificationsProduced: integer("classifications_produced").notNull().default(0),
    processedAt: timestamp("processed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.opportunityId, table.eventId] })],
);
