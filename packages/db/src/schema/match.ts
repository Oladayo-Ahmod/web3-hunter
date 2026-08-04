import { sql } from "drizzle-orm";
import {
  check,
  doublePrecision,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { opportunity } from "./opportunity";
import { user } from "./auth";

/**
 * The computed fit assessment between a User Profile and an Opportunity
 * (docs/DOMAIN_MODEL.md §Match) — always User Profile × Opportunity, never
 * User × Company (Domain Rule #4), enforced here structurally by this
 * table's two foreign keys.
 *
 * Like Company Intelligence and Opportunity, this is a **mutable,
 * rebuildable projection**: a `MatchComputed` Event (see
 * `packages/matching`) is published before this row is written or
 * updated, and this row exists purely so reading a User's current Matches
 * doesn't require replaying their entire Match history on every access.
 *
 * `id` is deterministic — derived from `(userId, opportunityId)` — not
 * randomly generated, mirroring `opportunity.id`'s derivation, so
 * recomputing the same Match never creates a duplicate row. The unique
 * constraint below is a database-level backstop for that same invariant.
 */
export const match = pgTable(
  "match",
  {
    id: uuid("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    opportunityId: uuid("opportunity_id")
      .notNull()
      .references(() => opportunity.id),
    score: doublePrecision("score").notNull(),
    reasoning: text("reasoning").notNull(),
    matchedSkillIds: uuid("matched_skill_ids").array().notNull().default([]),
    // When this Match's User Profile x Opportunity comparison was
    // evaluated. Unlike Company Intelligence/Opportunity's `asOf` (which
    // reflects a specific historical Event's time, since those are
    // derived by replaying a time-stamped Event sequence), a Match is a
    // comparison of *current* state — so this is the pipeline run's wall-
    // clock time, not a replayed historical timestamp. Distinct from
    // `updatedAt` (when this row was last written, which can lag
    // `computedAt` by nothing, since they're set together).
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("match_score_range", sql`${table.score} >= 0 AND ${table.score} <= 1`),
    unique("match_user_id_opportunity_id_key").on(table.userId, table.opportunityId),
  ],
);
