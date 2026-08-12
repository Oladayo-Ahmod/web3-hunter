import { and, eq } from "drizzle-orm";
import type { Database } from "../client";
import { companyDiscoveryProbe } from "../schema";

export interface RecordProbeInput {
  candidateName: string;
  candidateSlug: string;
  collectorSlug: string;
  result: "hit" | "miss";
  resolvedCompanyId?: string | null;
}

/**
 * Whether this exact `(candidateSlug, collectorSlug)` pair has already
 * been probed — regardless of outcome. Lets the discovery pipeline be
 * re-run repeatedly without re-checking (and re-rate-limiting against)
 * the same dead candidate forever, and is what makes "not yet checked"
 * distinguishable from "checked, found nothing" a real, queryable fact
 * rather than the same absence.
 */
export async function hasBeenProbed(
  db: Database,
  candidateSlug: string,
  collectorSlug: string,
): Promise<boolean> {
  const [existing] = await db
    .select({ id: companyDiscoveryProbe.id })
    .from(companyDiscoveryProbe)
    .where(
      and(
        eq(companyDiscoveryProbe.candidateSlug, candidateSlug),
        eq(companyDiscoveryProbe.collectorSlug, collectorSlug),
      ),
    )
    .limit(1);
  return existing !== undefined;
}

export async function recordProbe(db: Database, input: RecordProbeInput): Promise<void> {
  await db
    .insert(companyDiscoveryProbe)
    .values({
      candidateName: input.candidateName,
      candidateSlug: input.candidateSlug,
      collectorSlug: input.collectorSlug,
      result: input.result,
      resolvedCompanyId: input.resolvedCompanyId ?? null,
    })
    .onConflictDoNothing({
      target: [companyDiscoveryProbe.candidateSlug, companyDiscoveryProbe.collectorSlug],
    });
}
