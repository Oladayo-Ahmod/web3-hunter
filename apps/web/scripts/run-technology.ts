import { detectTechnologyForAllCompanies } from "../lib/pipeline/stages";

/**
 * Runs Technology detection for every Company — the same "no live
 * event-bus consumer, invoke on a schedule" pattern `collect:greenhouse`
 * and `classify:opportunities` use (docs/ROADMAP.md Milestones 2 and 9).
 * Company-scoped, like Scoring, not Opportunity-scoped like
 * Classification — see `packages/technology`'s `runTechnologyPipeline`.
 *
 * The per-entity loop itself lives in `../lib/pipeline/stages.ts`,
 * shared with `app/api/cron/pipeline/route.ts`. Prints as each Company
 * starts and finishes — against a remote database this can take a
 * while, and silent output is indistinguishable from a hang.
 *
 *   pnpm --filter @web3-hunter/web exec tsx scripts/run-technology.ts
 */
async function main() {
  const results = await detectTechnologyForAllCompanies({
    onStart: (id) => console.log(`[technology] ${id}: starting…`),
    onComplete: (entry) => {
      if (entry.status === "error") {
        console.error(`[technology] ${entry.id}: FAILED —`, entry.error);
        return;
      }

      const result = entry.result;
      console.log(
        `[technology] ${entry.id}: events processed ${result.eventsProcessed}, detections produced ${result.detectionsProduced}, profile updated ${result.profileUpdated}`,
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
    console.error("[technology] Fatal error running Technology detection:", error);
    process.exit(1);
  });
