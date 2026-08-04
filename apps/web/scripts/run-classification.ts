import { runClassificationPipeline } from "@web3-hunter/classification";
import { getDb, schema } from "@web3-hunter/db";
import { eq } from "drizzle-orm";

/**
 * Classifies every `scored` Opportunity that hasn't been classified yet —
 * the same "no live event-bus consumer, invoke on a schedule" pattern
 * `collect:greenhouse` uses (docs/ROADMAP.md Milestone 2).
 *
 *   pnpm --filter @web3-hunter/web exec tsx scripts/run-classification.ts
 */
async function main() {
  const opportunities = await getDb()
    .select({ id: schema.opportunity.id })
    .from(schema.opportunity)
    .where(eq(schema.opportunity.status, "scored"));

  for (const { id } of opportunities) {
    const result = await runClassificationPipeline(id);
    console.log(
      `[classify] ${id}: events processed ${result.eventsProcessed}, classifications produced ${result.classificationsProduced}`,
    );
  }
}

main().catch((error: unknown) => {
  console.error("[classify] Fatal error running classification:", error);
  process.exitCode = 1;
});
