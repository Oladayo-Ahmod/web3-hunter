import { sql } from "drizzle-orm";
import { check, doublePrecision, integer, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import { intelligenceTrend } from "./company-intelligence";
import { securityTarget } from "./security-target";

/**
 * Security Target Intelligence — the accumulated understanding of a
 * Security Target built from Security Signals over time. Same shape and
 * same "mutable, rebuildable projection over the immutable event log"
 * status as `company_intelligence` (see that table's doc comment) —
 * reusing the pattern, not the table, since the parent entity differs.
 *
 * Reuses `intelligenceTrend`: "increasing/stable/decreasing" momentum of
 * accumulated Signals is the same concept here as for a Company's hiring
 * momentum, just about different underlying Signals — defining a
 * near-duplicate enum for the same four values would be the kind of
 * speculative abstraction this phase avoids.
 *
 * Phase 1: this table exists so the relationship and persistence are
 * real and testable. No Signal detector produces a `SecurityIntelligenceUpdated`-equivalent
 * event yet (none is registered) — writes to this table are, for now,
 * direct projection upserts a caller supplies, not something this phase
 * computes.
 */
export const securityTargetIntelligence = pgTable(
  "security_target_intelligence",
  {
    securityTargetId: uuid("security_target_id")
      .primaryKey()
      .references(() => securityTarget.id),
    trend: intelligenceTrend("trend").notNull(),
    confidence: doublePrecision("confidence").notNull(),
    signalCount: integer("signal_count").notNull(),
    lastSignalAt: timestamp("last_signal_at", { withTimezone: true }),
    asOf: timestamp("as_of", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "security_target_intelligence_confidence_range",
      sql`${table.confidence} >= 0 AND ${table.confidence} <= 1`,
    ),
  ],
);
