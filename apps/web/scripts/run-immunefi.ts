import { runImmunefiCollector } from "../lib/collectors/run-immunefi";

/**
 * The "simplest viable" trigger for the Immunefi security-intelligence
 * Collector — the same on-a-schedule pattern `collect:defillama` uses.
 *
 *   pnpm --filter @web3-hunter/web exec tsx scripts/run-immunefi.ts
 */
async function main() {
  const result = await runImmunefiCollector();
  console.log(
    `[immunefi] fetched ${result.fetched}, published ${result.published}, skipped ${result.skipped}, ` +
      `collisions ${result.collisions.length}`,
  );
  for (const collision of result.collisions) {
    console.warn(`[immunefi] collision for "${collision.slug}": ${collision.message}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error("[immunefi] Fatal error running the collector:", error);
    process.exit(1);
  });
