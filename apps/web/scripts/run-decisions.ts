import { decideForAllUsers } from "../lib/pipeline/stages";

/**
 * Evaluates Recommendation creation, priority refresh, and staleness
 * expiration for every User with a Profile — the periodic counterpart to
 * the API route's on-save recompute (apps/web/app/api/profile/route.ts),
 * for picking up newly recomputed Matches against existing Profiles.
 *
 * The per-entity loop itself lives in `../lib/pipeline/stages.ts`,
 * shared with `app/api/cron/pipeline/route.ts`. Prints as each User
 * starts and finishes — against a remote database this can take a
 * while, and silent output is indistinguishable from a hang.
 *
 *   pnpm --filter @web3-hunter/web exec tsx scripts/run-decisions.ts
 */
async function main() {
  const results = await decideForAllUsers({
    onStart: (id) => console.log(`[decide] ${id}: starting…`),
    onComplete: (entry) => {
      if (entry.status === "error") {
        console.error(`[decide] ${entry.id}: FAILED —`, entry.error);
        return;
      }

      const result = entry.result;
      console.log(
        `[decide] ${entry.id}: matches considered ${result.matchesConsidered}, created ${result.recommendationsCreated}, ` +
          `refreshed ${result.recommendationsRefreshed}, expired ${result.recommendationsExpired}`,
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
    console.error("[decide] Fatal error running the Decision Engine:", error);
    process.exit(1);
  });
