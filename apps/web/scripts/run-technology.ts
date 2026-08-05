import { getDb, schema } from "@web3-hunter/db";
import { runTechnologyPipeline } from "@web3-hunter/technology";

/**
 * Runs Technology detection for every Company — the same "no live
 * event-bus consumer, invoke on a schedule" pattern `collect:greenhouse`
 * and `classify:opportunities` use (docs/ROADMAP.md Milestones 2 and 9).
 * Company-scoped, like Scoring, not Opportunity-scoped like
 * Classification — see `packages/technology`'s `runTechnologyPipeline`.
 *
 *   pnpm --filter @web3-hunter/web exec tsx scripts/run-technology.ts
 */
async function main() {
  const companies = await getDb().select({ id: schema.company.id }).from(schema.company);

  for (const { id } of companies) {
    const result = await runTechnologyPipeline(id);
    console.log(
      `[technology] ${id}: events processed ${result.eventsProcessed}, detections produced ${result.detectionsProduced}, profile updated ${result.profileUpdated}`,
    );
  }
}

main().catch((error: unknown) => {
  console.error("[technology] Fatal error running Technology detection:", error);
  process.exitCode = 1;
});
