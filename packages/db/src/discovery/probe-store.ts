import { and, eq, ne } from "drizzle-orm";
import type { Database } from "../client";
import { companyDiscoveryProbe } from "../schema";

export interface RecordProbeInput {
  candidateName: string;
  candidateSlug: string;
  collectorSlug: string;
  result: "hit" | "miss" | "error";
  resolvedCompanyId?: string | null;
}

/**
 * Whether this exact `(candidateSlug, collectorSlug)` pair has already
 * been probed *to a confident conclusion* — `"hit"` or `"miss"` only.
 * An `"error"` row (the probe couldn't be completed - see the schema's
 * doc comment) does NOT count as checked, deliberately: it must stay
 * eligible for retry on the next run, not be permanently treated as "no
 * board exists here" just because the earlier attempt failed to find out
 * either way.
 *
 * This is what lets the discovery pipeline be re-run repeatedly without
 * re-checking (and re-rate-limiting against) the same dead candidate
 * forever, while still recovering from a transient failure automatically
 * the next time it runs.
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
        ne(companyDiscoveryProbe.result, "error"),
      ),
    )
    .limit(1);
  return existing !== undefined;
}

/**
 * Upserts, not insert-only — deliberately. A retried candidate whose
 * *previous* attempt recorded `"error"` must be able to overwrite that
 * row with a confident `"hit"`/`"miss"` once the retry actually
 * completes; `onConflictDoNothing` would silently discard the real
 * result and leave the stale `"error"` row in place forever. This can
 * only ever fire for a row currently `"error"` in practice — `hit`/`miss`
 * rows are never re-attempted to begin with, since `hasBeenProbed`
 * already skips them.
 */
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
    .onConflictDoUpdate({
      target: [companyDiscoveryProbe.candidateSlug, companyDiscoveryProbe.collectorSlug],
      set: {
        result: input.result,
        resolvedCompanyId: input.resolvedCompanyId ?? null,
        checkedAt: new Date(),
      },
    });
}
