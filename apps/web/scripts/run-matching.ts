import { getDb, schema } from "@web3-hunter/db";
import { runMatchingPipeline } from "@web3-hunter/matching";
import { recordPipelineRun } from "../lib/observability/record-pipeline-run";

/**
 * Recomputes Matches for every User with a Profile — the periodic
 * counterpart to the API route's on-save recompute
 * (apps/web/app/api/profile/route.ts), for picking up newly classified
 * Opportunities against existing Profiles.
 *
 *   pnpm --filter @web3-hunter/web exec tsx scripts/run-matching.ts
 */
async function main() {
  const profiles = await getDb()
    .select({ userId: schema.userProfile.userId })
    .from(schema.userProfile);
  let hadFailure = false;

  for (const { userId } of profiles) {
    try {
      const result = await recordPipelineRun(
        { pipelineName: "matching", scopeType: "user", scopeId: userId },
        () => runMatchingPipeline(userId),
      );
      console.log(
        `[match] ${userId}: opportunities considered ${result.opportunitiesConsidered}, matches computed ${result.matchesComputed}`,
      );
    } catch (error) {
      hadFailure = true;
      console.error(`[match] ${userId}: FAILED —`, error);
    }
  }

  if (hadFailure) {
    process.exitCode = 1;
  }
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((error: unknown) => {
    console.error("[match] Fatal error running matching:", error);
    process.exit(1);
  });
