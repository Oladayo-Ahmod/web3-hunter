import { pgEnum, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { id, timestamps } from "../columns";

/**
 * A Company's ecosystem/vertical classification — Milestone 11. A small,
 * closed vocabulary by design, the same choice already made for
 * `event_category` (see ./event.ts): top-level ecosystem categories change
 * rarely (roughly once a year, if that), unlike `skill`, which genuinely
 * needed an open, seeded table because its vocabulary expands constantly.
 * Postgres enum values are easy to add (even inside a transaction, on the
 * Postgres 17 this project runs) but not to rename or remove — an
 * acceptable trade-off here specifically because this taxonomy only
 * realistically grows by addition. `other` is the deliberate safety valve
 * for a Company that doesn't fit the named categories, rather than forcing
 * a false classification.
 */
export const companyCategory = pgEnum("company_category", [
  "l1",
  "l2",
  "defi",
  "wallet",
  "security",
  "infrastructure",
  "ai",
  "gaming",
  "other",
]);

/**
 * How a Company entered the system — Milestone 13 Phase C. A closed
 * vocabulary, same reasoning as `companyCategory`: this only realistically
 * grows by addition (a new discovery channel), not by renaming existing
 * values.
 *
 * `curated`: added by hand (`apps/web/data/companies/*.json` via
 * `seed:companies`) — every Company through Milestone 12.
 * `discovered`: a probe (`packages/db/src/discovery`) found a live
 * Greenhouse/Lever/Ashby board for it and created this row automatically —
 * unreviewed.
 * `verified`: a `discovered` Company that's since been confirmed
 * legitimate — the promotion path, never a new row.
 * `rejected`: a probe hit that turned out to be noise or the wrong
 * company — kept, not deleted, so it's never re-probed and never shows up
 * as "not yet checked."
 */
export const companyDiscoveryStatus = pgEnum("company_discovery_status", [
  "curated",
  "discovered",
  "verified",
  "rejected",
]);

/**
 * Milestone 17 — an explainable, hand-assigned outreach priority, not a
 * computed score. Deliberately three values with no numeric weighting
 * behind them (docs/MILESTONE_16... §9's "do not pretend these are
 * scientifically precise" instruction) — a curator's judgment call at
 * seed time, the same "curated, operator-entered reference data" category
 * `fundingStage`/`headquarters` already are on this table, not a new
 * scoring subsystem. Nullable: most Companies (anything not part of the
 * outreach-focused curation pass) simply have no opinion recorded.
 */
export const companyPriority = pgEnum("company_priority", ["high", "medium", "low"]);

/**
 * The Company Aggregate (docs/DATABASE.md §3). Milestone 2 established
 * minimal identity (`slug`, `name`) — enough for a Source Event to
 * reference a stable Company record via `event.relatedEntityId`.
 * Milestone 11 adds curated profile metadata: every field below is
 * nullable and independently optional, since most companies will not have
 * all of them populated, and none of them is derived from replaying
 * Events — this is curated, operator-entered reference data, the same
 * category as the `skill` taxonomy, not an event-sourced projection.
 *
 * Deliberately absent: a GitHub organization column and an ATS-provider
 * column. Both are already fully derivable from `company_source_identity`
 * joined to `collector` — storing them again here would be a second,
 * driftable source of truth for a fact that table already owns.
 * Similarly, "hiring status" is not a column at all — it's computed from
 * whether a Company currently has open Job Postings (packages/application),
 * always current, never curated.
 */
export const company = pgTable("company", {
  id: id(),
  // A stable, human-readable identifier — for Milestone 2, the source's own
  // identifier for this company (e.g. a Greenhouse board token). Real
  // cross-source identity resolution is deferred, per docs/DATABASE.md §9.
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  websiteUrl: text("website_url"),
  careersPageUrl: text("careers_page_url"),
  documentationUrl: text("documentation_url"),
  blogUrl: text("blog_url"),
  twitterUrl: text("twitter_url"),
  discordUrl: text("discord_url"),
  linkedinUrl: text("linkedin_url"),
  logoUrl: text("logo_url"),
  description: text("description"),
  // Free-text location, e.g. "Remote", "New York, NY" — not a structured
  // (city, country) pair. Sparse and best-effort; not every company
  // discloses this.
  headquarters: text("headquarters"),
  // Free-text, e.g. "Seed", "Series A", "Public" — the least automatable
  // and least reliably available field on this table.
  fundingStage: text("funding_stage"),
  category: companyCategory("category"),
  tags: text("tags").array(),
  // Milestone 13 Phase C — discovery provenance. Defaults to "discovered"
  // for every *new* row from here on; the migration that adds this column
  // backfills every pre-existing row to "curated" explicitly (see
  // migrations/ - never left to the default, since "discovered" would be
  // factually wrong for the 37 companies actually added by hand).
  discoveryStatus: companyDiscoveryStatus("discovery_status").notNull().default("discovered"),
  // Which discovery channel found it, e.g. "ats-probe:electric-capital" -
  // null for curated Companies (there's nothing to attribute).
  discoverySource: text("discovery_source"),
  discoveredAt: timestamp("discovered_at", { withTimezone: true }),
  // Updated on every successful Collector run against this Company's
  // board(s) - the "is this ATS board still valid" signal, independent of
  // discoveryStatus (a curated Company's board can also go stale).
  lastVerifiedAt: timestamp("last_verified_at", { withTimezone: true }),
  priority: companyPriority("priority"),
  ...timestamps(),
});
