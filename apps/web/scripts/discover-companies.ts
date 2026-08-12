import { readFileSync } from "node:fs";
import { discoverCompanies, type DiscoveryCandidate } from "../lib/collectors/discover-companies";

/**
 * Milestone 13 Phase C — runs the ATS candidate-discovery pipeline over a
 * pre-prepared candidate batch (a JSON file of `{name, slugs}` entries).
 * The candidate list itself is generated separately (see the Phase C
 * production report for how this batch was derived from Electric
 * Capital's public "Open Dev Data" taxonomy) — this script only runs the
 * probe/resolve/attach pipeline, the same "no live event-bus consumer,
 * invoke on a schedule" pattern every other `collect:*` script uses.
 *
 *   pnpm --filter @web3-hunter/web exec tsx scripts/discover-companies.ts <path-to-candidates.json>
 */
async function main() {
  const candidatesPath = process.argv[2];
  if (!candidatesPath) {
    console.error("[discover] Usage: discover-companies.ts <path-to-candidates.json>");
    process.exit(1);
  }

  const candidates = JSON.parse(readFileSync(candidatesPath, "utf8")) as DiscoveryCandidate[];
  console.log(
    `[discover] Probing ${candidates.length} candidates against Greenhouse/Lever/Ashby...`,
  );

  const outcomes = await discoverCompanies(candidates, "electric-capital:ats-probe");

  const hits = outcomes.filter((o) => o.result === "hit");
  const created = hits.filter((o) => o.resolution === "created");
  const existing = hits.filter((o) => o.resolution === "existing");

  console.log(`\n[discover] Total probes: ${outcomes.length}`);
  console.log(`[discover] Hits: ${hits.length}`);
  console.log(`[discover] -> resolved to a NEW discovered company: ${created.length}`);
  console.log(`[discover] -> resolved to an already-known company: ${existing.length}`);

  for (const hit of hits) {
    console.log(
      `  [${hit.result}] ${hit.candidateName} -> ${hit.collectorSlug}:${hit.matchedSlug} (${hit.resolution})`,
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error("[discover] Fatal error running discovery:", error);
    process.exit(1);
  });
