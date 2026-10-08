import { scoreAllSecurityTargets } from "../lib/pipeline/stages";

/**
 * Runs Security Signal generation, Security Target Intelligence, and
 * Security Opportunity detection for every Security Target — the same
 * "no live event-bus consumer, invoke on a schedule" pattern
 * `run-scoring.ts` uses.
 *
 *   pnpm --filter @web3-hunter/web exec tsx scripts/run-security-scoring.ts
 */
async function main() {
  const results = await scoreAllSecurityTargets({
    onStart: (id) => console.log(`[security-score] ${id}: starting…`),
    onComplete: (entry) => {
      if (entry.status === "error") {
        console.error(`[security-score] ${entry.id}: FAILED —`, entry.error);
        return;
      }

      const result = entry.result;
      console.log(
        `[security-score] ${entry.id}: events processed ${result.eventsProcessed}, ` +
          `signals produced ${result.signalsProduced}, intelligence updates ${result.intelligenceUpdates}, ` +
          `opportunities detected ${result.opportunitiesDetected}`,
      );
    },
  });

  if (results.some((entry) => entry.status === "error")) {
    process.exitCode = 1;
  }
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((error: unknown) => {
    console.error("[security-score] Fatal error running Security Scoring:", error);
    process.exit(1);
  });
