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
import { id } from "../columns";
import { event } from "./event";
import { securityTarget } from "./security-target";

/**
 * A Security Signal — an interpreted, weighted piece of evidence about
 * what one or more Events mean for a Security Target, the Security
 * vertical's counterpart to `signal`. Same append-only, evidence-only
 * shape (see `signal`'s own doc comment) — `sourceEventIds` always
 * non-empty, no decay modeling yet.
 *
 * Unlike `signal`, this row's `id` is not yet derived from a triggering
 * Event's id: no `SecuritySignalDetected`-equivalent Event Type is
 * registered in this phase (the detector registry is deliberately
 * empty), so there is no producing Event to share an id with. Once a
 * real detector exists, the natural next step is the same convention
 * `signal` already uses.
 */
export const securitySignal = pgTable(
  "security_signal",
  {
    id: id(),
    securityTargetId: uuid("security_target_id")
      .notNull()
      .references(() => securityTarget.id),
    signalType: text("signal_type").notNull(),
    weight: doublePrecision("weight").notNull(),
    reasoning: text("reasoning").notNull(),
    sourceEventIds: uuid("source_event_ids").array().notNull(),
    detectedAt: timestamp("detected_at", { withTimezone: true }).notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("security_signal_weight_range", sql`${table.weight} >= 0 AND ${table.weight} <= 1`),
    index("security_signal_security_target_id_idx").on(table.securityTargetId),
    index("security_signal_type_idx").on(table.signalType),
  ],
);

/**
 * The ledger of which Source Events have been run through the Security
 * Signal Engine — the same "unprocessed work" pattern as
 * `signal_generation_ledger`. Not yet written to by anything in this
 * phase (there is no pipeline runner yet); the table exists so the
 * pattern is in place before a real producer needs it.
 */
export const securitySignalGenerationLedger = pgTable("security_signal_generation_ledger", {
  eventId: uuid("event_id")
    .primaryKey()
    .references(() => event.id),
  signalsProduced: integer("signals_produced").notNull().default(0),
  processedAt: timestamp("processed_at", { withTimezone: true }).notNull().defaultNow(),
});
