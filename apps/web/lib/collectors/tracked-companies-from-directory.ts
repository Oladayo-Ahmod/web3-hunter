import { getDb, schema } from "@web3-hunter/db";
import { eq } from "drizzle-orm";
import type { TrackedCompany } from "./run-collector";

/**
 * Resolves every company currently tracked on a given Collector, from
 * `company_source_identity` — Milestone 11's replacement for a static
 * tracked-company array (formerly `tracked-companies.ts`/
 * `tracked-github-orgs.ts`, both deleted this milestone). Any company
 * whose directory entry (see `apps/web/scripts/seed-companies.ts`)
 * declares a source for this Collector appears here; tracking a new
 * company on an already-supported Collector is a data change — a new
 * directory entry plus reseeding — never a code change.
 *
 * Deliberately generic across every ATS Collector (Greenhouse, Lever,
 * Ashby) and GitHub: each caller adapts the returned `sourceIdentifier`
 * to its own field name (`boardToken`, `site`, `boardName`, `org`) — the
 * same trivial rename `runGreenhouseCollector` already did internally
 * before this milestone, just now at the call site instead.
 */
export async function getTrackedCompaniesForCollector(
  collectorSlug: string,
): Promise<TrackedCompany[]> {
  return getDb()
    .select({
      companySlug: schema.company.slug,
      companyName: schema.company.name,
      sourceIdentifier: schema.companySourceIdentity.sourceIdentifier,
    })
    .from(schema.companySourceIdentity)
    .innerJoin(schema.collector, eq(schema.companySourceIdentity.collectorId, schema.collector.id))
    .innerJoin(schema.company, eq(schema.companySourceIdentity.companyId, schema.company.id))
    .where(eq(schema.collector.slug, collectorSlug));
}
