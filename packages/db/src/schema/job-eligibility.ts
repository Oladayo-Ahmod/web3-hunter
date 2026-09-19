import { boolean, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { company } from "./company";
import { event } from "./event";

/**
 * The persisted verdict of the Job eligibility gate
 * (`packages/application/src/apply-eligibility.ts`) for a Job's *current*
 * state — one row per `(companyId, externalId)`, the same identity
 * `job_skill` uses, since a Job has no table of its own (it is a
 * read-time projection over the Event log — see `job-query-service.ts`).
 *
 * WHY THIS EXISTS: the gate has to read a posting's full description to
 * decide, and every page (`/jobs`, `/today`, `/outreach`) used to
 * download every open job's description on every request just to re-run
 * it. That, plus two Collector reads, exhausted the Supabase egress
 * quota (12.35 GB against a 5 GB allowance in ~3 weeks). The verdict is a
 * pure function of a Job's title and description, so it is computed once
 * per Job *version* and stored; readers join it instead of re-deriving it.
 *
 * Operational read model, not a source of truth: it is fully derived from
 * events and can be dropped and rebuilt (`refreshJobEligibility` repopulates
 * it on the next call), so it is deliberately not itself event-sourced.
 *
 * - `stateEventId`: the `JobPosted`/`JobUpdated` Event whose title and
 *   description this verdict was computed from. A verdict only applies
 *   while it still names the Job's latest state Event; a newer Event makes
 *   it stale until re-evaluated.
 * - `gateFingerprint`: identifies the gate's rules at evaluation time. Edit
 *   a phrase list and every stored verdict is stale and re-evaluated
 *   automatically, with no manual step to forget.
 */
export const jobEligibility = pgTable(
  "job_eligibility",
  {
    companyId: uuid("company_id")
      .notNull()
      .references(() => company.id),
    externalId: text("external_id").notNull(),
    stateEventId: uuid("state_event_id")
      .notNull()
      .references(() => event.id),
    gateFingerprint: text("gate_fingerprint").notNull(),
    eligible: boolean("eligible").notNull(),
    reasonCode: text("reason_code").notNull(),
    evaluatedAt: timestamp("evaluated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.companyId, table.externalId] })],
);
