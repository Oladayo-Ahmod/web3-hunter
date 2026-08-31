import { classifyJobsForAllCompanies } from "../lib/pipeline/stages";

/**
 * Runs Job-level Skill classification for every Company — Milestone 13
 * Phase 2's counterpart to `run-classification.ts` (which classifies
 * Opportunities, not individual Jobs). Same "no live event-bus consumer,
 * invoke on a schedule" pattern every other pipeline script uses.
 *
 *   pnpm --filter @web3-hunter/web exec tsx scripts/run-job-classification.ts
 */
async function main() {
  const results = await classifyJobsForAllCompanies({
    onStart: (id) => console.log(`[job-classification] ${id}: starting…`),
    onComplete: (entry) => {
      if (entry.status === "error") {
        console.error(`[job-classification] ${entry.id}: FAILED —`, entry.error);
        return;
      }

      const result = entry.result;
      console.log(
        `[job-classification] ${entry.id}: events processed ${result.eventsProcessed}, classifications produced ${result.classificationsProduced}`,
      );
    },
  });

  const successCount = results.filter((entry) => entry.status !== "error").length;
  const errorCount = results.length - successCount;

  if (errorCount > 0) {
    console.error(
      `[job-classification] ${errorCount}/${results.length} companies failed this run.`,
    );
  }

  // Same partial-vs-total-failure distinction as run-greenhouse.ts et al.
  // — see that file's comment.
  if (results.length > 0 && successCount === 0) {
    process.exitCode = 1;
  }
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((error: unknown) => {
    console.error("[job-classification] Fatal error running Job classification:", error);
    process.exit(1);
  });
