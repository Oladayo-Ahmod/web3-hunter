import { pgTable, text } from "drizzle-orm/pg-core";
import { id, timestamps } from "../columns";

/**
 * The Company Aggregate (docs/DATABASE.md §3), in its minimal Milestone 2
 * form: enough identity for a Source Event to reference a stable Company
 * record via `event.relatedEntityId`. Full profile fields (funding stage,
 * size, Tech Stack) and cross-source entity resolution are out of scope
 * here — see docs/DATABASE.md §9 Open Question #4 — a Company is resolved
 * by `slug` alone within a single source for now.
 */
export const company = pgTable("company", {
  id: id(),
  // A stable, human-readable identifier — for Milestone 2, the source's own
  // identifier for this company (e.g. a Greenhouse board token). Real
  // cross-source identity resolution is deferred, per docs/DATABASE.md §9.
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  ...timestamps(),
});
