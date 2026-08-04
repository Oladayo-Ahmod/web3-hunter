import { getDb, schema } from "@web3-hunter/db";
import { runMatchingPipeline } from "@web3-hunter/matching";

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

  for (const { userId } of profiles) {
    const result = await runMatchingPipeline(userId);
    console.log(
      `[match] ${userId}: opportunities considered ${result.opportunitiesConsidered}, matches computed ${result.matchesComputed}`,
    );
  }
}

main().catch((error: unknown) => {
  console.error("[match] Fatal error running matching:", error);
  process.exitCode = 1;
});
