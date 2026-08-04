import { sql } from "drizzle-orm";
import {
  check,
  doublePrecision,
  integer,
  pgEnum,
  pgTable,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { company } from "./company";

/**
 * A Company's hiring-trend direction, per docs/DOMAIN_MODEL.md
 * §Intelligence. Closed vocabulary — a native enum, per docs/DATABASE.md
 * §4.
 */
export const intelligenceTrend = pgEnum("intelligence_trend", [
  "insufficient-data",
  "increasing",
  "stable",
  "decreasing",
]);

/**
 * Company Intelligence — the accumulated, continuously-updated
 * understanding of a Company's hiring momentum, per
 * docs/DOMAIN_MODEL.md §Intelligence.
 *
 * This is a **mutable, rebuildable projection**, not a canonical store:
 * per the approved Milestone 3 refinement, every meaningful change here is
 * preceded by an immutable `IntelligenceUpdated` Event (see
 * packages/scoring), and this row exists purely so reading a Company's
 * current profile doesn't require replaying its entire Signal history on
 * every access. `packages/scoring`'s `rebuildCompanyIntelligence` can
 * always reconstruct this table's contents from that Event history alone
 * — see docs/DATABASE.md §1 on the Canonical/Derived distinction.
 */
export const companyIntelligence = pgTable(
  "company_intelligence",
  {
    companyId: uuid("company_id")
      .primaryKey()
      .references(() => company.id),
    trend: intelligenceTrend("trend").notNull(),
    confidence: doublePrecision("confidence").notNull(),
    signalCount: integer("signal_count").notNull(),
    lastSignalAt: timestamp("last_signal_at", { withTimezone: true }),
    // The point in (event) time this projection reflects — the latest
    // contributing Signal's `detectedAt`, never wall-clock "now". Distinct
    // from `updatedAt` (when this row was last written).
    asOf: timestamp("as_of", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "company_intelligence_confidence_range",
      sql`${table.confidence} >= 0 AND ${table.confidence} <= 1`,
    ),
  ],
);
