import { getDb, schema } from "@web3-hunter/db";
import { asc } from "drizzle-orm";
import type { CollectorHealthDTO } from "./dto";
import { toCollectorHealthDTO } from "./mappers";

/**
 * Collector Health, per Milestone 8's Definition of Ready: a read-only
 * operational view over every Collector's most recent run — storage +
 * read API only, no dashboard, no alerting. Ordered by `slug` for a
 * stable, deterministic listing.
 */
export async function listCollectorHealth(): Promise<CollectorHealthDTO[]> {
  const rows = await getDb().select().from(schema.collector).orderBy(asc(schema.collector.slug));
  return rows.map(toCollectorHealthDTO);
}
