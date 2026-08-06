import { matchAllUsers } from "../lib/pipeline/stages";

/**
 * Recomputes Matches for every User with a Profile — the periodic
 * counterpart to the API route's on-save recompute
 * (apps/web/app/api/profile/route.ts), for picking up newly classified
 * Opportunities against existing Profiles.
 *
 * The per-entity loop itself lives in `../lib/pipeline/stages.ts`,
 * shared with `app/api/cron/pipeline/route.ts`. Prints as each User
 * starts and finishes — against a remote database this can take a
 * while, and silent output is indistinguishable from a hang.
 *
 *   pnpm --filter @web3-hunter/web exec tsx scripts/run-matching.ts
 */
async function main() {
  const results = await matchAllUsers({
    onStart: (id) => console.log(`[match] ${id}: starting…`),
    onComplete: (entry) => {
      if (entry.status === "error") {
        console.error(`[match] ${entry.id}: FAILED —`, entry.error);
        return;
      }

      const result = entry.result;
      console.log(
        `[match] ${entry.id}: opportunities considered ${result.opportunitiesConsidered}, matches computed ${result.matchesComputed}`,
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
    console.error("[match] Fatal error running matching:", error);
    process.exit(1);
  });
