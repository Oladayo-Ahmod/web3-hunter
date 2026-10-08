import { sql } from "drizzle-orm";
import {
  check,
  doublePrecision,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { opportunityStatus } from "./opportunity";
import { securityTarget } from "./security-target";

/**
 * The Security Opportunity Aggregate — the Security vertical's
 * counterpart to `opportunity`, deliberately a separate table rather
 * than reusing it directly: `opportunity.companyId` is a `NOT NULL` FK
 * that every existing read path (job feed, outreach, Today Digest,
 * Opportunity Feed) assumes points at a Company, and a Security
 * Opportunity's parent is a Security Target, a different entity. Same
 * shape, same deterministic-id/explainability guarantees, different
 * parent FK — reusing the *pattern*, not the table.
 *
 * `id` is deterministic — derived from `(securityTargetId,
 * opportunityType, detectionWindow)` via `deriveSecurityOpportunityId`
 * (`packages/security`) — for the same replay-safety reason
 * `opportunity.id` is deterministic (see that table's own doc comment).
 *
 * Reuses `opportunityStatus` ("detected"/"scored"): the lifecycle stage
 * this phase models is identical in meaning, not just in name.
 *
 * Whether Security Opportunities should eventually be unified into the
 * single `opportunity` table (once Matching/Decision/UI need to treat
 * both verticals uniformly) is an open, deliberately deferred question
 * — not decided here, same as `docs/ARCHITECTURE.md`'s own Open
 * Questions section defers things rather than resolving them
 * speculatively.
 */
export const securityOpportunity = pgTable(
  "security_opportunity",
  {
    id: uuid("id").primaryKey(),
    securityTargetId: uuid("security_target_id")
      .notNull()
      .references(() => securityTarget.id),
    // AUDIT_CONTEST | BUG_BOUNTY | ACTIVE_PROTOCOL | SHADOW_AUDIT |
    // SECURITY_RESEARCH | DISCLOSURE — named constants in
    // packages/security, open text here for the same reason
    // `opportunity.opportunityType` is: this vocabulary is expected to
    // grow.
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
      "security_opportunity_score_range",
      sql`${table.score} IS NULL OR (${table.score} >= 0 AND ${table.score} <= 1)`,
    ),
    unique("security_opportunity_target_type_window_key").on(
      table.securityTargetId,
      table.opportunityType,
      table.detectionWindow,
    ),
    index("security_opportunity_security_target_id_idx").on(table.securityTargetId),
  ],
);
