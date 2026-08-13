import { writeFileSync } from "node:fs";
import {
  buildDiscoveryCandidates,
  type DefiLlamaProtocol,
} from "../lib/collectors/defillama-candidates";

/**
 * Milestone 15 — the permanent replacement for the throwaway batch-1
 * prep script. Fetches DeFiLlama's real, live `/protocols` endpoint and
 * writes a ranked `DiscoveryCandidate[]` batch for
 * `discover-companies.ts` to consume — the candidate-selection logic
 * itself lives in the tested `defillama-candidates.ts` module, not here.
 *
 *   pnpm --filter @web3-hunter/web exec tsx scripts/prepare-defillama-batch.ts <output-path> [tier1Skip] [tier2Skip] [tier1Count] [tier2Count]
 *
 * `tier1Skip`/`tier2Skip` default to 450/50 — i.e. by default this
 * prepares the *next* batch after the first one (which used ranks 0-449
 * Tier 1 + 0-49 Tier 2), not a re-selection of the same top candidates.
 */
async function main() {
  const outputPath = process.argv[2];
  if (!outputPath) {
    console.error(
      "[prepare] Usage: prepare-defillama-batch.ts <output-path> [tier1Skip] [tier2Skip] [tier1Count] [tier2Count]",
    );
    process.exit(1);
  }
  const tier1Skip = Number(process.argv[3] ?? 450);
  const tier2Skip = Number(process.argv[4] ?? 50);
  const tier1Count = Number(process.argv[5] ?? 450);
  const tier2Count = Number(process.argv[6] ?? 50);

  console.log("[prepare] Fetching https://api.llama.fi/protocols...");
  const res = await fetch("https://api.llama.fi/protocols");
  if (!res.ok) {
    throw new Error(`DeFiLlama fetch failed: ${res.status}`);
  }
  const protocols = (await res.json()) as DefiLlamaProtocol[];
  console.log(`[prepare] Fetched ${protocols.length} raw protocol entries`);

  const candidates = buildDiscoveryCandidates(protocols, {
    tier1Skip,
    tier2Skip,
    tier1Count,
    tier2Count,
  });
  console.log(
    `[prepare] Selected ${candidates.length} candidates ` +
      `(Tier 1 ranks ${tier1Skip}-${tier1Skip + tier1Count - 1}, Tier 2 ranks ${tier2Skip}-${tier2Skip + tier2Count - 1})`,
  );

  writeFileSync(outputPath, JSON.stringify(candidates, null, 1));
  console.log(`[prepare] Wrote ${candidates.length} candidates to ${outputPath}`);
  console.log("[prepare] Sample:", JSON.stringify(candidates.slice(0, 3), null, 1));
}

main().catch((error: unknown) => {
  console.error("[prepare] Fatal error:", error);
  process.exit(1);
});
