import { sql } from "drizzle-orm";
import {
  check,
  doublePrecision,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { company } from "./company";

/**
 * An Opportunity's lifecycle stage, per docs/DOMAIN_MODEL.md §Opportunity.
 * Only the states this milestone produces are modeled; "Matched" and
 * "Archived" are introduced by later milestones (Matching, decay) — see
 * docs/ROADMAP.md Milestone 3's explicitly out-of-scope items.
 */
export const opportunityStatus = pgEnum("opportunity_status", ["detected", "scored"]);

/**
 * The Opportunity Aggregate, per docs/DATABASE.md §3 — the platform's
 * central actionable entity, per docs/ARCHITECTURE.md §1.1.
 *
 * Like Company Intelligence, this is a **mutable, rebuildable
 * projection**: `OpportunityDetected` and `OpportunityScored` Events (see
 * packages/scoring) are the canonical facts, and this row is a
 * synchronously-maintained read optimization over them.
 *
 * `id` is deterministic — derived from `(companyId, opportunityType,
 * detectionWindow)`, per the approved Milestone 3 refinement — not
 * randomly generated, so replaying the same history reproduces the same
 * Opportunity identity rather than creating duplicates. The unique
 * constraint below is a database-level backstop for that same invariant.
 */
export const opportunity = pgTable(
  "opportunity",
  {
    id: uuid("id").primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => company.id),
    opportunityType: text("opportunity_type").notNull(),
    detectionWindow: text("detection_window").notNull(),
    status: opportunityStatus("status").notNull().default("detected"),
    score: doublePrecision("score"),
    reasoning: text("reasoning").notNull(),
    detectedAt: timestamp("detected_at", { withTimezone: true }).notNull(),
    scoredAt: timestamp("scored_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "opportunity_score_range",
      sql`${table.score} IS NULL OR (${table.score} >= 0 AND ${table.score} <= 1)`,
    ),
    unique("opportunity_company_type_window_key").on(
      table.companyId,
      table.opportunityType,
      table.detectionWindow,
    ),
    index("opportunity_company_id_idx").on(table.companyId),
  ],
);
