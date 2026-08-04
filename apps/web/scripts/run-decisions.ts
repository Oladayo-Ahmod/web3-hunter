import { getDb, schema } from "@web3-hunter/db";
import { runDecisionPipeline } from "@web3-hunter/decision";

/**
 * Evaluates Recommendation creation, priority refresh, and staleness
 * expiration for every User with a Profile — the periodic counterpart to
 * the API route's on-save recompute (apps/web/app/api/profile/route.ts),
 * for picking up newly recomputed Matches against existing Profiles.
 *
 *   pnpm --filter @web3-hunter/web exec tsx scripts/run-decisions.ts
 */
async function main() {
  const profiles = await getDb()
    .select({ userId: schema.userProfile.userId })
    .from(schema.userProfile);

  for (const { userId } of profiles) {
    const result = await runDecisionPipeline(userId);
    console.log(
      `[decide] ${userId}: matches considered ${result.matchesConsidered}, created ${result.recommendationsCreated}, refreshed ${result.recommendationsRefreshed}, expired ${result.recommendationsExpired}`,
    );
  }
}

main().catch((error: unknown) => {
  console.error("[decide] Fatal error running the Decision Engine:", error);
  process.exitCode = 1;
});
