import { scoreAllCompanies } from "../lib/pipeline/stages";

/**
 * Runs Signal generation, Company Intelligence, and Opportunity detection
 * for every Company — the same "no live event-bus consumer, invoke on a
 * schedule" pattern every other pipeline script uses. Company-scoped, the
 * same shape `run-technology.ts` uses. Scoring previously had no trigger
 * script at all (flagged as a gap in Milestones 8 and 9); added here,
 * instrumented from the start, per Milestone 10.
 *
 * The per-entity loop itself lives in `../lib/pipeline/stages.ts`,
 * shared with `app/api/cron/pipeline/route.ts`.
 *
 *   pnpm --filter @web3-hunter/web exec tsx scripts/run-scoring.ts
 */
async function main() {
  const results = await scoreAllCompanies();
  let hadFailure = false;

  for (const entry of results) {
    if (entry.status === "error") {
      hadFailure = true;
      console.error(`[score] ${entry.id}: FAILED —`, entry.error);
      continue;
    }

    const result = entry.result;
    console.log(
      `[score] ${entry.id}: events processed ${result.eventsProcessed}, signals produced ${result.signalsProduced}, ` +
        `intelligence updates ${result.intelligenceUpdates}, opportunities detected ${result.opportunitiesDetected}, ` +
        `opportunities scored ${result.opportunitiesScored}`,
    );
  }

  if (hadFailure) {
    process.exitCode = 1;
  }
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((error: unknown) => {
    console.error("[score] Fatal error running Scoring:", error);
    process.exit(1);
  });
