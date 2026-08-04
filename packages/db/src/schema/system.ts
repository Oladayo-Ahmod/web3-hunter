import { pgTable } from "drizzle-orm/pg-core";
import { id, timestamps } from "../columns";

/**
 * A minimal, purely infrastructural table with no domain/business meaning.
 * It exists solely to prove the database migration workflow end-to-end and
 * to back the health check endpoint (apps/web/app/api/health/route.ts) with
 * a real read/write against Postgres — see docs/ROADMAP.md Milestone 0.
 *
 * Domain schema (Event, Company, Opportunity, ...) lands starting in
 * Milestone 1, per docs/DATABASE.md.
 */
export const systemHealthCheck = pgTable("system_health_check", {
  id: id(),
  ...timestamps(),
});
