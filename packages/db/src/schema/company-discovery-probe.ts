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
 * `result: "miss"` means the platform gave a confirmed, confident "no
 * board here" (a genuine `404`) — ordinary, expected, permanent.
 * `result: "error"` (added for the second discovery batch,
 * docs/MILESTONE_13_DISCOVERY_AND_RELEVANCE_REVIEW.md §22.5) means the
 * probe *couldn't be completed* — a transient network failure, a `5xx`,
 * anything that isn't a confident 404 — and is deliberately excluded from
 * `hasBeenProbed`'s "already checked" query, so it stays eligible for
 * retry on the next run rather than being permanently misrecorded as "no
 * board exists here."
 */
export const companyDiscoveryProbeResult = pgEnum("company_discovery_probe_result", [
  "hit",
  "miss",
  "error",
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
