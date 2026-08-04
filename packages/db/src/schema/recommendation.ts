import { sql } from "drizzle-orm";
import {
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { match } from "./match";
import { opportunity } from "./opportunity";
import { user } from "./auth";

/**
 * A Recommendation's lifecycle stage, per docs/DOMAIN_MODEL.md
 * §Recommendation and the Milestone 6 refinement's explicit state
 * machine:
 *
 *   active   --dismiss--> dismissed --restore--> active
 *   active   --archive--> archived  --restore--> active
 *   active   --expire -->  expired  (terminal)
 *
 * Closed vocabulary — a native enum, per docs/DATABASE.md §4.
 */
export const recommendationStatus = pgEnum("recommendation_status", [
  "active",
  "dismissed",
  "archived",
  "expired",
]);

/**
 * The Recommendation Aggregate (docs/DOMAIN_MODEL.md §Recommendation): the
 * Decision Engine's determination that a Match is worth surfacing to a
 * User. References exactly one Match — never a Company directly — per
 * Domain Rule #4's transitive constraint.
 *
 * A **mutable, rebuildable projection**, the same pattern established for
 * `match`/`opportunity`/`company_intelligence`: `RecommendationCreated`
 * and each lifecycle Event (`RecommendationDismissed`, `...Archived`,
 * `...Restored`, `...Expired`) are the canonical facts (see
 * `packages/decision`), and this row is a synchronously-maintained read
 * optimization over them. `packages/decision`'s
 * `rebuildRecommendationsForUser` can always reconstruct this table's
 * contents by replaying those Events.
 *
 * `id` is deterministic — derived from `matchId` alone — since a Match
 * has at most one Recommendation (docs/DOMAIN_MODEL.md §Match:
 * "may be the basis for zero or one active Recommendation at a time").
 * `priority` and `reasonCode`/`reasonDetails` are continuously
 * recomputed by the Decision Engine (Match owns score; Decision owns
 * priority) and are not independently event-sourced — only the discrete
 * lifecycle transitions are.
 */
export const recommendation = pgTable(
  "recommendation",
  {
    id: uuid("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    matchId: uuid("match_id")
      .notNull()
      .references(() => match.id),
    opportunityId: uuid("opportunity_id")
      .notNull()
      .references(() => opportunity.id),
    status: recommendationStatus("status").notNull().default("active"),
    priority: doublePrecision("priority").notNull(),
    reasonCode: text("reason_code").notNull(),
    reasonDetails: jsonb("reason_details").notNull(),
    reasonVersion: integer("reason_version").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    statusChangedAt: timestamp("status_changed_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("recommendation_priority_range", sql`${table.priority} >= 0 AND ${table.priority} <= 1`),
    unique("recommendation_match_id_key").on(table.matchId),
    index("recommendation_user_id_status_idx").on(table.userId, table.status),
  ],
);
