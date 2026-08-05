import { classifyAllOpportunities } from "../lib/pipeline/stages";

/**
 * Classifies every `scored` Opportunity that hasn't been classified yet —
 * the same "no live event-bus consumer, invoke on a schedule" pattern
 * `collect:greenhouse` uses (docs/ROADMAP.md Milestone 2).
 *
 * The per-entity loop itself lives in `../lib/pipeline/stages.ts`,
 * shared with `app/api/cron/pipeline/route.ts`.
 *
 *   pnpm --filter @web3-hunter/web exec tsx scripts/run-classification.ts
 */
async function main() {
  const results = await classifyAllOpportunities();
  let hadFailure = false;

  for (const entry of results) {
    if (entry.status === "error") {
      hadFailure = true;
      console.error(`[classify] ${entry.id}: FAILED —`, entry.error);
      continue;
    }

    const result = entry.result;
    console.log(
      `[classify] ${entry.id}: events processed ${result.eventsProcessed}, classifications produced ${result.classificationsProduced}`,
    );
  }

  if (hadFailure) {
    process.exitCode = 1;
  }
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((error: unknown) => {
    console.error("[classify] Fatal error running classification:", error);
    process.exit(1);
  });
