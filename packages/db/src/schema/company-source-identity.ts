import { pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { id } from "../columns";
import { collector } from "./collector";
import { company } from "./company";

/**
 * The explicit, auditable record of cross-source Company identity
 * resolution, per Milestone 8: "the merge algorithm must be deterministic
 * and explainable." A row here means "this Collector's own identifier for
 * a company (a Greenhouse board token, a Lever site slug, an Ashby job
 * board name) has been declared to refer to this Company" — declared by
 * whoever configures a Collector's tracked companies (see
 * `apps/web/lib/collectors/run-collector.ts`), never inferred by fuzzy or
 * heuristic name matching. Resolution itself still goes through
 * `company.slug` (a canonical, operator-chosen identifier shared across a
 * company's per-source configurations) exactly as before Milestone 8; this
 * table exists so "why did these three sources merge into one Company" is
 * a queryable fact instead of an implicit config coincidence.
 *
 * Insert-once for now: there is no update path for repointing a source
 * identifier to a different Company (see docs/ROADMAP.md Milestone 8's
 * Definition of Ready, Risks). Retroactively discovering that two already-
 * separate Company rows are duplicates — DOMAIN_MODEL.md's Company
 * "Merged" lifecycle transition — remains a distinct, deferred capability;
 * this table only prevents duplicates prospectively, at ingestion time.
 */
export const companySourceIdentity = pgTable(
  "company_source_identity",
  {
    id: id(),
    collectorId: uuid("collector_id")
      .notNull()
      .references(() => collector.id),
    // This Collector's own identifier for the company (e.g. a Greenhouse
    // board token, a Lever site slug, an Ashby job board name) — the
    // source-specific half of the mapping. `company.slug` is the
    // canonical, cross-source half.
    sourceIdentifier: text("source_identifier").notNull(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => company.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("company_source_identity_collector_id_source_identifier_key").on(
      table.collectorId,
      table.sourceIdentifier,
    ),
  ],
);
