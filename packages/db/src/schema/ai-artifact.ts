import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { company } from "./company";
import { opportunity } from "./opportunity";
import { recommendation } from "./recommendation";
import { user } from "./auth";

/**
 * Shared column set for every AI Artifact table, per Milestone 7: AI
 * artifacts are append-only (a regeneration inserts a new row, never
 * updates one) and carry two independent version numbers —
 *
 * - `version`: the sequential regeneration count for this source entity
 *   (1, 2, 3, ...), the "Regeneration creates a new version rather than
 *   overwriting" requirement.
 * - `promptVersion`: which code-level prompt-template revision produced
 *   this row, the same schema-version-marker convention
 *   `packages/decision`'s `REASON_VERSION` uses. A prompt-template change
 *   makes a cached artifact stale even if the source entity hasn't
 *   changed, forcing a new `version` at the new `promptVersion` rather
 *   than silently reusing old output.
 *
 * `id` is deterministic (derived from the source entity ID + `version`),
 * so a crash-retried generation recovers cleanly instead of duplicating.
 * There is no immutability trigger on these tables at the Postgres level
 * (unlike `signal`/`opportunity_skill`) because nothing here is
 * event-sourced from a canonical Event in the same way — the *events*
 * these artifacts publish (`AIRecommendationGenerated`, etc.) are the
 * immutable historical facts; these rows are the read-optimized content
 * store the UI actually renders, intentionally simple rather than
 * mirroring the Event-first pattern used for deterministic facts.
 */
function aiArtifactColumns() {
  return {
    id: uuid("id").primaryKey(),
    content: text("content").notNull(),
    version: integer("version").notNull(),
    promptVersion: integer("prompt_version").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
  };
}

export const recommendationExplanation = pgTable(
  "recommendation_explanation",
  {
    ...aiArtifactColumns(),
    recommendationId: uuid("recommendation_id")
      .notNull()
      .references(() => recommendation.id),
  },
  (table) => [
    check(
      "recommendation_explanation_version_positive",
      sql`${table.version} > 0 AND ${table.promptVersion} > 0`,
    ),
    unique("recommendation_explanation_recommendation_id_version_key").on(
      table.recommendationId,
      table.version,
    ),
    index("recommendation_explanation_recommendation_id_idx").on(table.recommendationId),
  ],
);

export const opportunitySummary = pgTable(
  "opportunity_summary",
  {
    ...aiArtifactColumns(),
    opportunityId: uuid("opportunity_id")
      .notNull()
      .references(() => opportunity.id),
  },
  (table) => [
    check(
      "opportunity_summary_version_positive",
      sql`${table.version} > 0 AND ${table.promptVersion} > 0`,
    ),
    unique("opportunity_summary_opportunity_id_version_key").on(table.opportunityId, table.version),
    index("opportunity_summary_opportunity_id_idx").on(table.opportunityId),
  ],
);

export const companySummary = pgTable(
  "company_summary",
  {
    ...aiArtifactColumns(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => company.id),
  },
  (table) => [
    check(
      "company_summary_version_positive",
      sql`${table.version} > 0 AND ${table.promptVersion} > 0`,
    ),
    unique("company_summary_company_id_version_key").on(table.companyId, table.version),
    index("company_summary_company_id_idx").on(table.companyId),
  ],
);

export const outreachDraft = pgTable(
  "outreach_draft",
  {
    ...aiArtifactColumns(),
    recommendationId: uuid("recommendation_id")
      .notNull()
      .references(() => recommendation.id),
  },
  (table) => [
    check(
      "outreach_draft_version_positive",
      sql`${table.version} > 0 AND ${table.promptVersion} > 0`,
    ),
    unique("outreach_draft_recommendation_id_version_key").on(
      table.recommendationId,
      table.version,
    ),
    index("outreach_draft_recommendation_id_idx").on(table.recommendationId),
  ],
);

export const profileInsight = pgTable(
  "profile_insight",
  {
    ...aiArtifactColumns(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [
    check(
      "profile_insight_version_positive",
      sql`${table.version} > 0 AND ${table.promptVersion} > 0`,
    ),
    unique("profile_insight_user_id_version_key").on(table.userId, table.version),
    index("profile_insight_user_id_idx").on(table.userId),
  ],
);
