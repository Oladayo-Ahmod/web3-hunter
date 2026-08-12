import { ashby, greenhouse, lever } from "@web3-hunter/collectors";
import {
  getDb,
  hasBeenProbed,
  normalizeCompanyName,
  recordProbe,
  resolveDiscoveredCompany,
  resolveOrCreateCollector,
  schema,
} from "@web3-hunter/db";
import { eq } from "drizzle-orm";

/**
 * Milestone 13 Phase C — the ATS candidate-discovery pipeline
 * (docs/MILESTONE_13_DISCOVERY_AND_RELEVANCE_REVIEW.md §3). Deliberately
 * *not* a new Collector: it reuses `packages/collectors`'
 * `fetchGreenhouseJobs`/`fetchLeverPostings`/`fetchAshbyJobs` completely
 * unmodified — the exact same functions the real Greenhouse/Lever/Ashby
 * Collectors call — to check whether a candidate name has a live board on
 * any of the three platforms. A hit resolves (or creates) a `company` row
 * via `resolveDiscoveredCompany`'s conservative, exact-match-only
 * hierarchy, then wires up `company_source_identity` exactly the way
 * `upsertCompanyDirectory` does for a curated entry — from that point on,
 * a discovered board is indistinguishable from a curated one to every
 * downstream stage (the real Greenhouse/Lever/Ashby Collector runs,
 * normalization, Skill/Role classification, relevance scoring): they all
 * key off `company_source_identity`, which doesn't know or care how a row
 * got there.
 */

export interface DiscoveryCandidate {
  /** The candidate's display name, as it came from the discovery source (e.g. a GitHub org login). */
  name: string;
  /** Slug variants to try, in order — stops at the first hit. */
  slugs: readonly string[];
}

export interface DiscoveryOutcome {
  candidateName: string;
  collectorSlug: string;
  /** `"error"` means the probe couldn't be completed for any slug variant tried (transient failure) — distinct from a confident `"miss"`. See `packages/db/src/schema/company-discovery-probe.ts`'s doc comment. */
  result: "hit" | "miss" | "error";
  matchedSlug?: string;
  companyId?: string;
  resolution?: "existing" | "created";
}

const ATS_COLLECTORS = [
  { slug: "greenhouse", sourceType: "ats", fetch: greenhouse.fetchGreenhouseJobs },
  { slug: "lever", sourceType: "ats", fetch: lever.fetchLeverPostings },
  { slug: "ashby", sourceType: "ats", fetch: ashby.fetchAshbyJobs },
] as const;

/**
 * Extracts the ATS board's *own* claimed company name, when the platform
 * exposes one — confirmed live against real data: Greenhouse's job
 * payload includes a `company_name` field (present via `.passthrough()`
 * even though `GreenhouseJob`'s zod schema doesn't declare it - the same
 * "preserve the source's native shape" reasoning that field exists for in
 * the first place). Lever and Ashby's postings expose no equivalent
 * structured field - `null` for those, not a guess.
 *
 * This exists because a confirmed board (a real HTTP 200 with parseable
 * jobs) is not the same claim as "this board belongs to the candidate
 * I was probing for." Found via real production data: probing for
 * "switchboard-xyz" (the Solana oracle project) and "unlock-protocol"
 * hit real, live boards on Ashby (`switchboard`) and Greenhouse
 * (`unlock`) that turned out to belong to a credit-union IT staffing
 * firm and a home-equity fintech company, respectively — same short,
 * generic slug, completely unrelated real-world company. Exact-name
 * company *resolution* (`resolveDiscoveredCompany`) can't catch this on
 * its own, because there was never a name collision to check against -
 * the bug is upstream, in treating "the slug resolved" as "the candidate
 * matched," which this check closes wherever the source structurally
 * allows it.
 */
function extractClaimedCompanyName(collectorSlug: string, jobs: readonly unknown[]): string | null {
  if (collectorSlug !== "greenhouse") {
    return null;
  }
  const first = jobs[0] as { company_name?: unknown } | undefined;
  return typeof first?.company_name === "string" ? first.company_name : null;
}

/**
 * Classifies a failed fetch as a confident `"miss"` (a genuine `404` —
 * "no board exists at this slug," permanent) or an `"error"` (anything
 * else — a `5xx`, a timeout, DNS failure, etc. — the probe simply
 * couldn't be completed, and must stay retryable rather than being
 * recorded as a permanent not-found).
 *
 * `fetchGreenhouseJobs`/`fetchLeverPostings`/`fetchAshbyJobs` all throw a
 * plain `Error` embedding the HTTP status in its message text (e.g.
 * `"...failed for board \"x\": 404 Not Found"`) for any non-`ok`
 * response, and something differently-shaped for a network-level failure
 * (no HTTP response at all). Parsing the message is the only signal
 * available without changing those functions themselves, which this
 * milestone's collectors are explicitly not to be modified for.
 */
export function classifyFetchFailure(error: unknown): "miss" | "error" {
  const message = error instanceof Error ? error.message : String(error);
  return /\b404\b/.test(message) ? "miss" : "error";
}

/** Returns whether a row was actually inserted — `false` means this exact `(collectorSlug, sourceIdentifier)` pair was already claimed by another Company (see the caller's handling of that case for a newly-*created* Company). */
async function attachSourceIdentity(
  collectorSlug: string,
  sourceType: string,
  sourceIdentifier: string,
  companyId: string,
): Promise<boolean> {
  const db = getDb();
  const collectorId = await resolveOrCreateCollector(db, collectorSlug, sourceType);
  const [inserted] = await db
    .insert(schema.companySourceIdentity)
    .values({ collectorId, sourceIdentifier, companyId })
    .onConflictDoNothing({
      target: [
        schema.companySourceIdentity.collectorId,
        schema.companySourceIdentity.sourceIdentifier,
      ],
    })
    .returning();
  return inserted !== undefined;
}

/**
 * Probes one candidate against one ATS platform, trying each slug variant
 * in order until a hit or the list is exhausted. Every attempt is
 * recorded via `recordProbe` regardless of outcome — see that module's
 * doc comment for why "not yet checked" must stay distinguishable from
 * "checked, found nothing."
 */
async function probeCandidateAgainstCollector(
  candidate: DiscoveryCandidate,
  collectorConfig: (typeof ATS_COLLECTORS)[number],
  discoverySource: string,
): Promise<DiscoveryOutcome> {
  const db = getDb();
  // Tracks the least-confident outcome seen across this candidate's slug
  // variants, for the fallback return below — a single "error" among
  // otherwise-confirmed "miss"es means the candidate as a whole isn't
  // fully resolved yet and should stay open to retry (see the doc
  // comment on `classifyFetchFailure`/`hasBeenProbed`).
  let sawError = false;

  for (const slug of candidate.slugs) {
    const alreadyProbed = await hasBeenProbed(db, slug, collectorConfig.slug);
    if (alreadyProbed) {
      continue;
    }

    try {
      const jobs = await collectorConfig.fetch(slug);
      // A successful fetch (even zero currently-open jobs) means the
      // board itself is real - the exact "confirmed hit" bar Milestone
      // 12's manual probing already established. That is not yet proof
      // it's *this candidate's* board - see extractClaimedCompanyName.
      const claimedName = extractClaimedCompanyName(collectorConfig.slug, jobs);
      if (
        claimedName &&
        normalizeCompanyName(claimedName) !== normalizeCompanyName(candidate.name)
      ) {
        await recordProbe(db, {
          candidateName: candidate.name,
          candidateSlug: slug,
          collectorSlug: collectorConfig.slug,
          result: "miss",
        });
        continue;
      }

      const resolution = await resolveDiscoveredCompany(
        db,
        { candidateName: candidate.name },
        discoverySource,
      );
      await recordProbe(db, {
        candidateName: candidate.name,
        candidateSlug: slug,
        collectorSlug: collectorConfig.slug,
        result: "hit",
        resolvedCompanyId: resolution.companyId,
      });
      const attached = await attachSourceIdentity(
        collectorConfig.slug,
        collectorConfig.sourceType,
        slug,
        resolution.companyId,
      );

      if (resolution.kind === "created" && !attached) {
        // This candidate's normalized name didn't exact-match any
        // existing Company (§5's conservative hierarchy correctly
        // refused to guess), but the board it found is already claimed
        // by a different Company row — almost always the same real
        // company under a name that normalizes differently (e.g.
        // "Compound" vs. the GitHub org "compound-finance"). The new row
        // has no working source and never will under this same
        // candidate/slug pair; marking it "rejected" immediately keeps
        // it from silently inflating the company count as an inert
        // duplicate, per this milestone's explicit instruction not to.
        await db
          .update(schema.company)
          .set({ discoveryStatus: "rejected" })
          .where(eq(schema.company.id, resolution.companyId));
      }

      return {
        candidateName: candidate.name,
        collectorSlug: collectorConfig.slug,
        result: "hit",
        matchedSlug: slug,
        companyId: resolution.companyId,
        resolution: resolution.kind,
      };
    } catch (error) {
      const classification = classifyFetchFailure(error);
      sawError = sawError || classification === "error";
      await recordProbe(db, {
        candidateName: candidate.name,
        candidateSlug: slug,
        collectorSlug: collectorConfig.slug,
        result: classification,
      });
    }
  }

  return {
    candidateName: candidate.name,
    collectorSlug: collectorConfig.slug,
    result: sawError ? "error" : "miss",
  };
}

// Matches `run-collector.ts`'s `FETCH_CONCURRENCY` (ADR 0001) — the same
// three ATS platforms, the same "bounded concurrent external calls, don't
// overwhelm the endpoint" reasoning. Kept as the one shared convention
// rather than a second, independently-tuned concurrency value: a
// discovery batch is a much larger *volume* of requests than a normal
// Collector run even though each one is cheaper, which is a reason to
// stay aligned with the proven-safe number, not to raise it.
const DISCOVERY_CONCURRENCY = 5;

/**
 * Runs the full discovery pipeline over a candidate list, against all
 * three ATS platforms. Bounded concurrency across *candidates* (not
 * within one candidate's own slug-variant retries, which must stay
 * sequential so a hit on the first variant skips the rest) - the same
 * "many independent external calls" reasoning `run-collector.ts`'s fetch
 * phase already uses.
 *
 * Each task is individually isolated (its own try/catch) - a single
 * unexpected failure (e.g. a transient DB error, not an ATS fetch
 * failure, which `probeCandidateAgainstCollector` already handles on its
 * own) only costs that one `(candidate, platform)` pair, not the whole
 * batch. Before this, an uncaught exception from one concurrent worker
 * would reject the entire `Promise.all`, silently discarding whatever
 * every other concurrent worker was mid-way through - a real gap found
 * by inspection before scaling past the first, 150-candidate batch (see
 * docs/MILESTONE_13_DISCOVERY_AND_RELEVANCE_REVIEW.md §22.4). A task
 * that fails this way is simply never recorded, so it stays "unprobed"
 * and is retried automatically on the next run - no special handling
 * needed beyond not crashing.
 */
export async function discoverCompanies(
  candidates: readonly DiscoveryCandidate[],
  discoverySource: string,
  concurrency = DISCOVERY_CONCURRENCY,
): Promise<DiscoveryOutcome[]> {
  const results: DiscoveryOutcome[] = [];
  const errors: { candidateName: string; collectorSlug: string; error: unknown }[] = [];
  const tasks = candidates.flatMap((candidate) =>
    ATS_COLLECTORS.map((collectorConfig) => ({ candidate, collectorConfig })),
  );

  let next = 0;
  async function runner() {
    while (next < tasks.length) {
      const index = next++;
      const task = tasks[index]!;
      try {
        const outcome = await probeCandidateAgainstCollector(
          task.candidate,
          task.collectorConfig,
          discoverySource,
        );
        results.push(outcome);
      } catch (error) {
        // Deliberately not re-thrown: an unexpected failure here (not a
        // classified ATS fetch failure, which never reaches this catch)
        // must not take down the other concurrent workers' progress.
        errors.push({
          candidateName: task.candidate.name,
          collectorSlug: task.collectorConfig.slug,
          error,
        });
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, runner));

  if (errors.length > 0) {
    console.error(
      `[discover] ${errors.length} task(s) failed unexpectedly and were skipped (not recorded - will retry next run):`,
      errors.map((e) => `${e.candidateName}/${e.collectorSlug}: ${String(e.error)}`),
    );
  }

  return results;
}
