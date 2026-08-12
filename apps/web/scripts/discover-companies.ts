import { readFileSync } from "node:fs";
import { discoverCompanies, type DiscoveryCandidate } from "../lib/collectors/discover-companies";

/** The one previously-hardcoded value — kept as the default so every existing invocation (Electric Capital batches 1/2) keeps working unchanged. */
const DEFAULT_DISCOVERY_SOURCE = "electric-capital:ats-probe";

/**
 * Milestone 13 Phase C — runs the ATS candidate-discovery pipeline over a
 * pre-prepared candidate batch (a JSON file of `{name, slugs}` entries).
 * The candidate list itself is generated separately (see the Phase C
 * production report for how this batch was derived from Electric
 * Capital's public "Open Dev Data" taxonomy) — this script only runs the
 * probe/resolve/attach pipeline, the same "no live event-bus consumer,
 * invoke on a schedule" pattern every other `collect:*` script uses.
 *
 * `discoverySource` (Milestone 15) — an optional second argument, so a
 * different candidate source (e.g. DeFiLlama) can be attributed
 * separately in `company.discoverySource` without a second discovery
 * system: same runner, same probe/resolve/attach pipeline, just a
 * different candidate-list input and label. Defaults to the Electric
 * Capital label so existing usage is unaffected.
 *
 *   pnpm --filter @web3-hunter/web exec tsx scripts/discover-companies.ts <path-to-candidates.json> [discoverySource]
 */
async function main() {
  const candidatesPath = process.argv[2];
  if (!candidatesPath) {
    console.error(
      "[discover] Usage: discover-companies.ts <path-to-candidates.json> [discoverySource]",
    );
    process.exit(1);
  }
  const discoverySource = process.argv[3] ?? DEFAULT_DISCOVERY_SOURCE;

  const candidates = JSON.parse(readFileSync(candidatesPath, "utf8")) as DiscoveryCandidate[];
  console.log(
    `[discover] Probing ${candidates.length} candidates (source: ${discoverySource}) against Greenhouse/Lever/Ashby...`,
  );

  const outcomes = await discoverCompanies(candidates, discoverySource);

  const hits = outcomes.filter((o) => o.result === "hit");
  const misses = outcomes.filter((o) => o.result === "miss");
  const errors = outcomes.filter((o) => o.result === "error");
  const created = hits.filter((o) => o.resolution === "created");
  const existing = hits.filter((o) => o.resolution === "existing");

  console.log(`\n[discover] Total candidate/platform outcomes: ${outcomes.length}`);
  console.log(`[discover] Hits: ${hits.length}`);
  console.log(`[discover] Misses (confirmed 404): ${misses.length}`);
  console.log(`[discover] Errors (transient - retryable next run): ${errors.length}`);
  console.log(`[discover] -> resolved to a NEW discovered company: ${created.length}`);
  console.log(`[discover] -> resolved to an already-known company: ${existing.length}`);

  for (const hit of hits) {
    console.log(
      `  [${hit.result}] ${hit.candidateName} -> ${hit.collectorSlug}:${hit.matchedSlug} (${hit.resolution})`,
    );
  }

  if (errors.length > 0) {
    console.log("\n[discover] Candidates needing retry (transient errors):");
    for (const e of errors) {
      console.log(`  ${e.candidateName} / ${e.collectorSlug}`);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error("[discover] Fatal error running discovery:", error);
    process.exit(1);
  });
