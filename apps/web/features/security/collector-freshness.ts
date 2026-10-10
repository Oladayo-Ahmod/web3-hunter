import type { PipelineHealthDTO } from "@web3-hunter/application";

/**
 * How trustworthy the most recent DefiLlama/Immunefi collection is, for
 * display on the Security Research Feed. Deliberately distinct from
 * "healthy"/"unhealthy": `unknown` means the service itself couldn't say
 * anything (health fetch failed, or the Collector was never configured),
 * never that things are fine.
 */
export type SecurityCollectorFreshnessState =
  "fresh" | "stale" | "never-collected" | "failing" | "unknown";

export interface SecurityCollectorFreshness {
  slug: string;
  state: SecurityCollectorFreshnessState;
  /** The real `lastRunAt` from `CollectorHealthWithFreshnessDTO`, verbatim — `null` whenever there is no successful run to report, never substituted with the current time. */
  lastRunAt: string | null;
  consecutiveFailures: number | null;
}

/**
 * Derives one Security-relevant Collector's display state from
 * `getPipelineHealth()`'s own data — no new freshness rule, just a
 * precedence over facts the service already reports (`status`,
 * `isStale`, `lastRunAt`). `health === null` covers a failed
 * `getPipelineHealth()` call (see `/security/page.tsx`'s
 * `.catch(() => null)`, mirroring `/api/health`'s own precedent) — it
 * must read the same as "this Collector is missing," never as "fresh."
 *
 * Precedence, most specific first:
 * 1. `status === "degraded"` → `"failing"`, even when also stale — a
 *    confirmed failed run is more specific than "aged past threshold."
 *    `run-defillama.ts`/`run-immunefi.ts` only ever set `"degraded"` on
 *    a run that threw, with `lastRunAt` left untouched — unlike the ATS
 *    Collectors' partial-progress case, so this is unambiguous here.
 * 2. `lastRunAt === null` (and not degraded) → `"never-collected"` —
 *    distinct from "stale": there has never been a successful run to
 *    report, not one that aged out.
 * 3. `isStale === true` → `"stale"` — a previously successful run that
 *    has aged past its threshold.
 * 4. `status === "active"` and not stale → `"fresh"`. Any other status
 *    (`"configured"`/`"disabled"` with a non-null `lastRunAt`, an
 *    inconsistent combination `run-defillama.ts`/`run-immunefi.ts` never
 *    actually produce) falls back to `"unknown"` rather than claiming a
 *    confidence the status doesn't support.
 */
export function deriveSecurityCollectorFreshness(
  health: PipelineHealthDTO | null,
  slug: string,
): SecurityCollectorFreshness {
  const collector = health?.collectors.find((candidate) => candidate.slug === slug);

  if (!collector) {
    return { slug, state: "unknown", lastRunAt: null, consecutiveFailures: null };
  }

  if (collector.status === "degraded") {
    return {
      slug,
      state: "failing",
      lastRunAt: collector.lastRunAt,
      consecutiveFailures: collector.consecutiveFailures,
    };
  }

  if (collector.lastRunAt === null) {
    return {
      slug,
      state: "never-collected",
      lastRunAt: null,
      consecutiveFailures: collector.consecutiveFailures,
    };
  }

  if (collector.isStale) {
    return {
      slug,
      state: "stale",
      lastRunAt: collector.lastRunAt,
      consecutiveFailures: collector.consecutiveFailures,
    };
  }

  if (collector.status === "active") {
    return {
      slug,
      state: "fresh",
      lastRunAt: collector.lastRunAt,
      consecutiveFailures: collector.consecutiveFailures,
    };
  }

  return {
    slug,
    state: "unknown",
    lastRunAt: collector.lastRunAt,
    consecutiveFailures: collector.consecutiveFailures,
  };
}
