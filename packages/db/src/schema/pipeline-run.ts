import { index, integer, jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { id } from "../columns";

/**
 * A pipeline invocation's outcome — succeeded or failed. Closed vocabulary,
 * a native enum, per docs/DATABASE.md §4 ("Enums") — the same convention
 * `collector_status` uses.
 */
export const pipelineRunStatus = pgEnum("pipeline_run_status", ["succeeded", "failed"]);

/**
 * Pipeline Run — the execution-history counterpart to Collector Health
 * (Milestone 8), extended to the deterministic pipelines downstream of
 * ingestion: Scoring, Classification, Technology, Matching, Decision, per
 * Milestone 10.
 *
 * Structurally an append-only **log**, not a mutable per-entity snapshot
 * like `collector`'s health columns: a Collector is one singular,
 * persistent entity naturally represented by one row, but Scoring/
 * Classification/Technology/Matching/Decision are invoked once *per
 * Company, Opportunity, or User*, repeatedly — there is no singular entity
 * to snapshot. Each invocation gets its own row instead.
 *
 * `scopeId` deliberately has no foreign key: it references a Company,
 * Opportunity, or User depending on `scopeType`, the same polymorphic-
 * reference-without-FK pattern `event.relatedEntityId` already uses, for
 * the same reason (one column, several possible referents).
 *
 * `metrics` holds each pipeline's own result object verbatim — the five
 * pipelines' result shapes are heterogeneous
 * (`ScoringPipelineResult`/`ClassificationPipelineResult`/etc. all differ),
 * so this is jsonb rather than a fixed set of columns, the same trade-off
 * `event.metadata` already makes for the equivalent reason.
 *
 * Deliberately not event-sourced: no Event is published for a pipeline
 * run, matching Collector Health's own precedent (`recordRunHealth` in
 * `apps/web/lib/collectors/run-collector.ts` writes directly to
 * `collector`'s health columns with no Event either) — this is
 * operational telemetry about *how* the system ran, not a business fact
 * about the world. For the same reason, this table is deliberately
 * excluded from every existing replay-determinism test: `startedAt`/
 * `completedAt`/`durationMs` are wall-clock-bound and can never be
 * reproduced by replaying the same business data twice.
 */
export const pipelineRun = pgTable(
  "pipeline_run",
  {
    id: id(),
    // "scoring" | "classification" | "technology" | "matching" | "decision"
    // — deliberately plain text, not an enum: unlike `pipeline_run_status`
    // (genuinely closed), the set of pipelines is expected to grow exactly
    // as the set of domain packages grows, the same "open text describing
    // a closed-for-now but growing set" reasoning `collector.sourceType`
    // already uses.
    pipelineName: text("pipeline_name").notNull(),
    // "company" | "user" | "opportunity"
    scopeType: text("scope_type").notNull(),
    scopeId: uuid("scope_id").notNull(),
    status: pipelineRunStatus("status").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }).notNull(),
    durationMs: integer("duration_ms").notNull(),
    // Populated on success only — the pipeline's own result object, verbatim.
    metrics: jsonb("metrics"),
    // Populated on failure only.
    errorMessage: text("error_message"),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("pipeline_run_pipeline_name_idx").on(table.pipelineName),
    index("pipeline_run_scope_idx").on(table.scopeType, table.scopeId),
    index("pipeline_run_recorded_at_idx").on(table.recordedAt),
  ],
);
