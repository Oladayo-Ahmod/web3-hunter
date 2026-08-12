import { pgEnum, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { id } from "../columns";
import { company } from "./company";

/**
 * A single candidate-slug-against-one-ATS-platform check, recorded
 * regardless of outcome — Milestone 13 Phase C's discovery pipeline.
 * Exists specifically so "not yet checked" and "checked, found nothing"
 * are two different, queryable states, not the same absence: without this
 * table, re-running the probe pipeline would have no memory of past
 * misses and would re-probe the same dead candidate forever, and there
 * would be no way to report a real false-positive/hit rate (a required
 * Phase C production metric) after the fact.
 *
 * `result: "hit"` always pairs with a `resolvedCompanyId` — the Company
 * that candidate/collector combination resolved to (see
 * `./company-resolution.ts`'s conservative, exact-match-only hierarchy).
 * `result: "miss"` means the platform returned no valid board for that
 * slug — ordinary, expected, not an error.
 */
export const companyDiscoveryProbeResult = pgEnum("company_discovery_probe_result", [
  "hit",
  "miss",
]);

export const companyDiscoveryProbe = pgTable(
  "company_discovery_probe",
  {
    id: id(),
    // The un-normalized candidate name as it came from the discovery
    // source (e.g. "Acme Labs Inc.") — kept alongside the normalized slug
    // actually tried, for auditability.
    candidateName: text("candidate_name").notNull(),
    candidateSlug: text("candidate_slug").notNull(),
    collectorSlug: text("collector_slug").notNull(),
    result: companyDiscoveryProbeResult("result").notNull(),
    checkedAt: timestamp("checked_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedCompanyId: uuid("resolved_company_id").references(() => company.id),
  },
  (table) => [
    unique("company_discovery_probe_candidate_slug_collector_slug_key").on(
      table.candidateSlug,
      table.collectorSlug,
    ),
  ],
);
