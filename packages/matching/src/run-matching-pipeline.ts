import { getDb, schema } from "@web3-hunter/db";
import { eq } from "drizzle-orm";
import { evaluateMatch } from "./match-store";

export interface MatchingPipelineResult {
  opportunitiesConsidered: number;
  matchesComputed: number;
}

/**
 * Recomputes one User's Match against every currently `scored`
 * Opportunity — the trigger for "your Profile changed" or "run this
 * periodically" invocations, per docs/ROADMAP.md Milestone 5. User-scoped
 * rather than Opportunity-scoped: personalized feed ranking needs "all of
 * this User's Matches," which is the natural unit of work here, the same
 * way `runScoringPipeline` is Company-scoped because "all of this
 * Company's Signals" is its natural unit.
 *
 * `asOf` defaults to wall-clock "now" for real callers but can be supplied
 * explicitly for deterministic replay — the same optional-parameter shape
 * `runDecisionPipeline` uses, per Milestone 8's replay-determinism tests.
 */
export async function runMatchingPipeline(
  userId: string,
  asOf: Date = new Date(),
): Promise<MatchingPipelineResult> {
  const db = getDb();

  const scoredOpportunities = await db
    .select()
    .from(schema.opportunity)
    .where(eq(schema.opportunity.status, "scored"));

  const result: MatchingPipelineResult = {
    opportunitiesConsidered: scoredOpportunities.length,
    matchesComputed: 0,
  };

  for (const opportunityRow of scoredOpportunities) {
    const evaluation = await evaluateMatch(userId, opportunityRow.id, asOf);
    if (evaluation?.computed) {
      result.matchesComputed += 1;
    }
  }

  return result;
}
