import { runDefiLlamaCollector } from "../lib/collectors/run-defillama";

/**
 * The "simplest viable" trigger for the DefiLlama security-intelligence
 * Collector — the same on-a-schedule pattern `collect:github` uses.
 *
 *   pnpm --filter @web3-hunter/web exec tsx scripts/run-defillama.ts
 */
async function main() {
  const result = await runDefiLlamaCollector();
  console.log(
    `[defillama] fetched ${result.fetched}, tracked ${result.tracked}, ` +
      `published ${result.published}, skipped ${result.skipped}`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error("[defillama] Fatal error running the collector:", error);
    process.exit(1);
  });
