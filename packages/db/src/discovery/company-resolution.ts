import { eq } from "drizzle-orm";
import type { Database } from "../client";
import { company } from "../schema";

export interface ResolveDiscoveredCompanyInput {
  candidateName: string;
  /** A confirmed board's own claimed website/company domain, when the ATS platform's response exposes one — not every source does. */
  candidateDomain?: string | null;
}

export type CompanyResolution =
  | { kind: "existing"; companyId: string; matchedVia: "domain" | "name" }
  | { kind: "created"; companyId: string };

const COMPANY_SUFFIX_PATTERN = /\b(inc|incorporated|ltd|limited|llc|corp|corporation|co)\.?\b/g;

export function normalizeCompanyName(name: string): string {
  return name
    .toLowerCase()
    .replace(COMPANY_SUFFIX_PATTERN, "")
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

function normalizeDomain(url: string): string {
  return url
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "");
}

/**
 * The Milestone 13 Phase C company-resolution hierarchy — deliberately
 * exact-match only, no fuzzy/similarity scoring at any tier
 * (docs/MILESTONE_13_DISCOVERY_AND_RELEVANCE_REVIEW.md §5): exact
 * canonical domain match, then exact normalized name match (strip a
 * fixed, small list of corporate suffixes and non-alphanumeric
 * characters — nothing fuzzier), then create a new `discoveryStatus:
 * "discovered"` Company.
 *
 * False negatives (two rows for what's really one company - e.g. "Acme
 * Labs" vs "Acme Labs, Inc." with a slightly different recorded name)
 * are accepted. False positives (wrongly merging two different
 * companies) are structurally impossible under this hierarchy - the
 * explicit, non-negotiable trade-off this milestone's design review
 * settled on.
 *
 * Linear-scans the full `company` table rather than a SQL `WHERE` per
 * tier - the table is small (dozens to low hundreds of rows even after
 * heavy discovery) and this keeps both normalization functions the only
 * place the matching rules live, instead of duplicating them as SQL.
 */
export async function resolveDiscoveredCompany(
  db: Database,
  input: ResolveDiscoveredCompanyInput,
  discoverySource: string,
): Promise<CompanyResolution> {
  const allCompanies = await db.select().from(company);

  if (input.candidateDomain) {
    const normalizedCandidateDomain = normalizeDomain(input.candidateDomain);
    const domainMatch = allCompanies.find(
      (row) => row.websiteUrl && normalizeDomain(row.websiteUrl) === normalizedCandidateDomain,
    );
    if (domainMatch) {
      return { kind: "existing", companyId: domainMatch.id, matchedVia: "domain" };
    }
  }

  const normalizedCandidateName = normalizeCompanyName(input.candidateName);
  const nameMatch = allCompanies.find(
    (row) => normalizeCompanyName(row.name) === normalizedCandidateName,
  );
  if (nameMatch) {
    return { kind: "existing", companyId: nameMatch.id, matchedVia: "name" };
  }

  const slug = normalizedCandidateName || `discovered-${Date.now()}`;
  const [created] = await db
    .insert(company)
    .values({
      slug,
      name: input.candidateName,
      discoveryStatus: "discovered",
      discoverySource,
      discoveredAt: new Date(),
    })
    .onConflictDoNothing({ target: company.slug })
    .returning();

  if (created) {
    return { kind: "created", companyId: created.id };
  }

  // A race (or a genuine slug collision from a differently-named
  // candidate normalizing the same way) - re-resolve by slug rather than
  // fail; still exact, still conservative.
  const [existing] = await db.select().from(company).where(eq(company.slug, slug)).limit(1);
  if (!existing) {
    throw new Error(`Failed to resolve or create company for candidate "${input.candidateName}".`);
  }
  return { kind: "existing", companyId: existing.id, matchedVia: "name" };
}
