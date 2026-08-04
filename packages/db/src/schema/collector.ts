import { jsonb, pgEnum, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { id, timestamps } from "../columns";

/**
 * A Collector's operational status, per docs/DOMAIN_MODEL.md §Collector
 * ("Configured → Active → Degraded → Disabled"). Unlike an Event's `type`
 * (see ./event.ts), this vocabulary is genuinely closed — a new status
 * would be an architectural change to the Collector lifecycle itself, not
 * a routine addition — so it is a native Postgres enum, per
 * docs/DATABASE.md §4 ("Enums").
 */
export const collectorStatus = pgEnum("collector_status", [
  "configured",
  "active",
  "degraded",
  "disabled",
]);

/**
 * The persistent identity and configuration of a single source-specific
 * ingestion adapter — the Collector aggregate from docs/DATABASE.md §3.
 * Every Source Event references exactly one row here (see ./event.ts and
 * docs/DOMAIN_MODEL.md §Collector's invariant). Collector *behavior*
 * (scheduling, health transitions) is implemented starting in Milestone 2;
 * this milestone only owns the schema those future collectors attach to.
 */
export const collector = pgTable("collector", {
  id: id(),
  // A stable, human-readable identifier (e.g. "greenhouse", "github") —
  // never the display name, which may change.
  slug: text("slug").notNull().unique(),
  // The kind of external source this Collector integrates with (e.g.
  // "ats", "vcs", "rss"). Deliberately open text, not an enum: new source
  // kinds are expected to appear as new Collectors are added, per
  // docs/EVENT_MODEL.md §Future Extensions.
  sourceType: text("source_type").notNull(),
  status: collectorStatus("status").notNull().default("configured"),
  config: jsonb("config").notNull().default({}),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }),
  lastErrorAt: timestamp("last_error_at", { withTimezone: true }),
  lastErrorMessage: text("last_error_message"),
  ...timestamps(),
});
