import { refreshJobEligibility } from "@web3-hunter/application";
import { classifyJobsForAllCompanies } from "../lib/pipeline/stages";

/**
 * Runs Job-level Skill classification for every Company — Milestone 13
 * Phase 2's counterpart to `run-classification.ts` (which classifies
 * Opportunities, not individual Jobs). Same "no live event-bus consumer,
 * invoke on a schedule" pattern every other pipeline script uses.
 *
 * Also computes the stored eligibility verdict for every new or changed
 * Job (`refreshJobEligibility`), so `/jobs`, `/today` and `/outreach` read a
 * verdict instead of downloading every description to re-derive it. Pages
 * repeat this on read, so a failure here is logged, not fatal.
 *
 *   pnpm --filter @web3-hunter/web exec tsx scripts/run-job-classification.ts
 */
async function main() {
  try {
    const eligibility = await refreshJobEligibility();
    console.log(`[job-eligibility] evaluated ${eligibility.evaluated} new or changed job(s).`);
  } catch (error) {
    console.error("[job-eligibility] Refresh failed; pages will retry it on first read:", error);
  }

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
