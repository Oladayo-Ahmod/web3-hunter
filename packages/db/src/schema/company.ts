import { pgEnum, pgTable, text } from "drizzle-orm/pg-core";
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
  ...timestamps(),
});
