import { getDb, schema } from "@web3-hunter/db";
import { runScoringPipeline } from "@web3-hunter/scoring";
import { recordPipelineRun } from "../lib/observability/record-pipeline-run";

/**
 * Runs Signal generation, Company Intelligence, and Opportunity detection
 * for every Company — the same "no live event-bus consumer, invoke on a
 * schedule" pattern every other pipeline script uses. Company-scoped, the
 * same shape `run-technology.ts` uses. Scoring previously had no trigger
 * script at all (flagged as a gap in Milestones 8 and 9); added here,
 * instrumented from the start, per Milestone 10.
 *
 *   pnpm --filter @web3-hunter/web exec tsx scripts/run-scoring.ts
 */
async function main() {
  const companies = await getDb().select({ id: schema.company.id }).from(schema.company);
  let hadFailure = false;

  for (const { id } of companies) {
    try {
      const result = await recordPipelineRun(
        { pipelineName: "scoring", scopeType: "company", scopeId: id },
        () => runScoringPipeline(id),
      );
      console.log(
        `[score] ${id}: events processed ${result.eventsProcessed}, signals produced ${result.signalsProduced}, ` +
          `intelligence updates ${result.intelligenceUpdates}, opportunities detected ${result.opportunitiesDetected}, ` +
          `opportunities scored ${result.opportunitiesScored}`,
      );
    } catch (error) {
      hadFailure = true;
      console.error(`[score] ${id}: FAILED —`, error);
    }
  }

  if (hadFailure) {
    process.exitCode = 1;
  }
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((error: unknown) => {
    console.error("[score] Fatal error running Scoring:", error);
    process.exit(1);
  });
