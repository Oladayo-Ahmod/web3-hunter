import { sql } from "drizzle-orm";
import {
  check,
  doublePrecision,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { company } from "./company";
import { event } from "./event";

/**
 * A Signal — an interpreted, weighted piece of evidence about what one or
 * more Events mean for a Company's hiring likelihood, per
 * docs/DOMAIN_MODEL.md §Signal. Its `id` is not independently generated:
 * it is the same ID as the `HiringSignalDetected` Event that recorded its
 * detection (see packages/scoring), so this row is a queryable,
 * structured mirror of that Event rather than a second source of truth —
 * the Event remains canonical.
 *
 * Append-only: a Signal's detection is an immutable historical fact (see
 * docs/DATABASE.md §2 — "Canonical (its detection)"). Signal decay is
 * deliberately out of scope here (see docs/ROADMAP.md Milestone 3); this
 * table only records detections.
 */
export const signal = pgTable(
  "signal",
  {
    id: uuid("id").primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => company.id),
    signalType: text("signal_type").notNull(),
    weight: doublePrecision("weight").notNull(),
    reasoning: text("reasoning").notNull(),
    // The events this Signal is evidence of — always at least one. A
    // separate array column rather than a join table: a Signal's sources
    // are fixed at detection time and never grow, unlike an Event's
    // provenance (see ./event.ts's event_provenance), so there's no
    // many-to-many relationship to model relationally here.
    sourceEventIds: uuid("source_event_ids").array().notNull(),
    // When the fact this Signal interprets actually occurred — the
    // triggering Event's `occurredAt`, never wall-clock "now". This is
    // what keeps Signal generation replay-deterministic.
    detectedAt: timestamp("detected_at", { withTimezone: true }).notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("signal_weight_range", sql`${table.weight} >= 0 AND ${table.weight} <= 1`),
    index("signal_company_id_idx").on(table.companyId),
    index("signal_type_idx").on(table.signalType),
  ],
);

/**
 * The ledger of which Source Events have been run through the Signal
 * Engine — the same "unprocessed work" pattern as
 * `raw_record_ingestion` (see ./raw-record.ts), applied one stage further
 * downstream. A row here means "this Event has been evaluated against
 * every registered Signal detector," regardless of whether any of them
 * fired.
 */
export const signalGenerationLedger = pgTable("signal_generation_ledger", {
  eventId: uuid("event_id")
    .primaryKey()
    .references(() => event.id),
  signalsProduced: integer("signals_produced").notNull().default(0),
  processedAt: timestamp("processed_at", { withTimezone: true }).notNull().defaultNow(),
});
