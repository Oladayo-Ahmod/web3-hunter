import { getDb, schema } from "@web3-hunter/db";
import { runDecisionPipeline } from "@web3-hunter/decision";
import { recordPipelineRun } from "../lib/observability/record-pipeline-run";

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
  let hadFailure = false;

  for (const { userId } of profiles) {
    try {
      const result = await recordPipelineRun(
        { pipelineName: "decision", scopeType: "user", scopeId: userId },
        () => runDecisionPipeline(userId),
      );
      console.log(
        `[decide] ${userId}: matches considered ${result.matchesConsidered}, created ${result.recommendationsCreated}, ` +
          `refreshed ${result.recommendationsRefreshed}, expired ${result.recommendationsExpired}`,
      );
    } catch (error) {
      hadFailure = true;
      console.error(`[decide] ${userId}: FAILED —`, error);
    }
  }

  if (hadFailure) {
    process.exitCode = 1;
  }
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((error: unknown) => {
    console.error("[decide] Fatal error running the Decision Engine:", error);
    process.exit(1);
  });
