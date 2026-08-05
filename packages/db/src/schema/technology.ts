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
import { company } from "./company";
import { event } from "./event";
import { skill } from "./skill";

/**
 * A Technology Detection — an interpreted, explainable piece of evidence
 * that a Company uses a particular Skill/technology, derived from GitHub
 * repository facts (primary language, topics), per docs/ROADMAP.md
 * Milestone 9. Structurally the Technology Intelligence counterpart to
 * `packages/scoring`'s `signal`: its `id` is the same ID as the
 * `TechnologyDetected` Event that recorded it (see `packages/technology`),
 * so this row is a queryable, structured mirror of that Event, not a
 * second source of truth.
 *
 * Deliberately reuses the Skill taxonomy (`packages/db`'s `skill` table)
 * rather than introducing a separate "technology" vocabulary — a
 * Company's GitHub-evidenced Rust usage and a User's declared Rust Skill
 * are the same taxonomy entry, which is what makes comparing them for
 * Match's technology-fit component (`packages/matching`) meaningful.
 *
 * Append-only: a detection is an immutable historical fact, same as
 * `signal` and `opportunity_skill`. Multiple rows may exist for the same
 * (companyId, skillId) pair over time as GitHub activity re-evidences it —
 * deliberately not unique-constrained, mirroring `signal`'s shape rather
 * than `opportunity_skill`'s.
 */
export const technologyDetection = pgTable(
  "technology_detection",
  {
    id: uuid("id").primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => company.id),
    skillId: uuid("skill_id")
      .notNull()
      .references(() => skill.id),
    confidence: doublePrecision("confidence").notNull(),
    reasoning: text("reasoning").notNull(),
    sourceEventIds: uuid("source_event_ids").array().notNull(),
    detectedAt: timestamp("detected_at", { withTimezone: true }).notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "technology_detection_confidence_range",
      sql`${table.confidence} >= 0 AND ${table.confidence} <= 1`,
    ),
    index("technology_detection_company_id_idx").on(table.companyId),
  ],
);

/**
 * Company Technology Profile — the accumulated, continuously-updated set
 * of Skills a Company's own GitHub activity evidences, per
 * docs/ROADMAP.md Milestone 9. Structurally the Technology Intelligence
 * counterpart to `packages/scoring`'s `company_intelligence`: a
 * **mutable, rebuildable projection**, not a canonical store —
 * `packages/technology`'s `rebuildCompanyTechnologyProfile` can always
 * reconstruct this table's contents by replaying `technology_detection`
 * history alone. Unlike `company_intelligence`, this is a plain
 * aggregation (the union of evidenced Skills), not a statistically
 * computed trend/confidence — so, unlike Company Intelligence, there is
 * no dedicated "profile updated" Event: each contributing
 * `TechnologyDetected` Event already justifies this rollup's contents,
 * the same relationship `opportunity_skill` has to
 * `OpportunitySkillDetected`.
 *
 * Deliberately independent of `company_intelligence`: GitHub activity
 * changing this table must never, by itself, change a Company's hiring
 * Intelligence or an Opportunity's score (docs/ROADMAP.md Milestone 9's
 * required independence invariant) — `packages/scoring` neither reads
 * nor writes this table.
 */
export const companyTechnologyProfile = pgTable("company_technology_profile", {
  companyId: uuid("company_id")
    .primaryKey()
    .references(() => company.id),
  skillIds: uuid("skill_ids").array().notNull().default([]),
  evidenceCount: integer("evidence_count").notNull().default(0),
  // The point in (event) time this projection reflects — the latest
  // contributing detection's `detectedAt`, never wall-clock "now",
  // mirroring `company_intelligence.asOf`.
  asOf: timestamp("as_of", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * The ledger of which Source Events have been run through the Technology
 * Detector registry — the same "unprocessed work" pattern as
 * `signal_generation_ledger`, since Technology detection, like Signal
 * generation, is Company-scoped rather than Opportunity-scoped. A row
 * here means "this Event has been evaluated against every registered
 * Technology Detector," regardless of whether any of them fired —
 * including Source Events no Technology Detector cares about (e.g.
 * `JobPosted`), which simply produce zero detections.
 */
export const technologyDetectionLedger = pgTable("technology_detection_ledger", {
  eventId: uuid("event_id")
    .primaryKey()
    .references(() => event.id),
  technologiesDetected: integer("technologies_detected").notNull().default(0),
  processedAt: timestamp("processed_at", { withTimezone: true }).notNull().defaultNow(),
});
