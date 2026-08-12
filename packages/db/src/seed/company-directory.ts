import type { Database } from "../client";
import { company, companySourceIdentity, type companyCategory } from "../schema";
import { resolveOrCreateCollector } from "./collector-resolution";

/**
 * Every Collector slug the company directory can reference, and the
 * `sourceType` used to resolve/create its `collector` row if this is the
 * first time it's been declared. A curator writing a directory entry only
 * ever needs to know the slug — `sourceType` is this module's concern,
 * not theirs, and centralizing it here means it's declared once, not
 * once per entry across however many companies reference it.
 */
export const KNOWN_COLLECTORS: Readonly<Record<string, string>> = {
  greenhouse: "ats",
  lever: "ats",
  ashby: "ats",
  github: "vcs",
};

export interface CompanyDirectorySource {
  collectorSlug: string;
  sourceIdentifier: string;
}

export interface CompanyDirectoryEntry {
  companySlug: string;
  companyName: string;
  websiteUrl?: string | null;
  careersPageUrl?: string | null;
  documentationUrl?: string | null;
  blogUrl?: string | null;
  twitterUrl?: string | null;
  discordUrl?: string | null;
  linkedinUrl?: string | null;
  logoUrl?: string | null;
  description?: string | null;
  headquarters?: string | null;
  fundingStage?: string | null;
  category?: (typeof companyCategory.enumValues)[number] | null;
  tags?: readonly string[] | null;
  sources: readonly CompanyDirectorySource[];
}

export interface CompanyDirectoryUpsertResult {
  companySlug: string;
  companyId: string;
}

/**
 * Idempotently upserts the curated company directory — see
 * apps/web/scripts/seed-companies.ts, the only intended caller. Takes
 * already-parsed, already-validated data; performs no filesystem access
 * of its own. `packages/db` never does — see that script's own doc
 * comment and Milestone 11's Definition of Ready, "Architectural
 * Boundaries".
 *
 * Enriches an existing Company (matched by `slug`) in place rather than
 * recreating it — this is what makes reseeding safe against a Company a
 * live Collector run has already resolved reactively, before this
 * directory entry for it ever existed.
 *
 * `company_source_identity` rows are inserted, never updated, once per
 * (collector, sourceIdentifier) pair — consistent with that table's own,
 * pre-existing "insert-once for now" invariant (see its schema doc
 * comment): this seed never repoints an already-declared source
 * identifier at a different Company.
 */
export async function upsertCompanyDirectory(
  db: Database,
  entries: readonly CompanyDirectoryEntry[],
): Promise<CompanyDirectoryUpsertResult[]> {
  const results: CompanyDirectoryUpsertResult[] = [];

  for (const entry of entries) {
    const profileFields = {
      name: entry.companyName,
      // Every row this function writes came from a hand-authored JSON
      // file - explicit, not the column's "discovered" default (which
      // exists for packages/db/src/discovery's probe-driven path, not
      // this one). Set on every upsert, not just insert, so a Company a
      // live Collector run already created reactively (pre-Milestone-13,
      // "discovered" by construction since nothing set it explicitly)
      // gets corrected the moment a real directory entry for it exists.
      discoveryStatus: "curated" as const,
      websiteUrl: entry.websiteUrl ?? null,
      careersPageUrl: entry.careersPageUrl ?? null,
      documentationUrl: entry.documentationUrl ?? null,
      blogUrl: entry.blogUrl ?? null,
      twitterUrl: entry.twitterUrl ?? null,
      discordUrl: entry.discordUrl ?? null,
      linkedinUrl: entry.linkedinUrl ?? null,
      logoUrl: entry.logoUrl ?? null,
      description: entry.description ?? null,
      headquarters: entry.headquarters ?? null,
      fundingStage: entry.fundingStage ?? null,
      category: entry.category ?? null,
      tags: entry.tags ? [...entry.tags] : null,
    };

    const [row] = await db
      .insert(company)
      .values({ slug: entry.companySlug, ...profileFields })
      .onConflictDoUpdate({
        target: company.slug,
        set: { ...profileFields, updatedAt: new Date() },
      })
      .returning();

    if (!row) {
      throw new Error(`Failed to upsert company "${entry.companySlug}".`);
    }

    for (const source of entry.sources) {
      const sourceType = KNOWN_COLLECTORS[source.collectorSlug];
      if (!sourceType) {
        throw new Error(
          `Unknown collector slug "${source.collectorSlug}" for company "${entry.companySlug}".`,
        );
      }

      const collectorId = await resolveOrCreateCollector(db, source.collectorSlug, sourceType);

      await db
        .insert(companySourceIdentity)
        .values({
          collectorId,
          sourceIdentifier: source.sourceIdentifier,
          companyId: row.id,
        })
        .onConflictDoNothing({
          target: [companySourceIdentity.collectorId, companySourceIdentity.sourceIdentifier],
        });
    }

    results.push({ companySlug: entry.companySlug, companyId: row.id });
  }

  return results;
}
