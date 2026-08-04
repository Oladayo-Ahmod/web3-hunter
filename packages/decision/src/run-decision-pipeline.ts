import { getDb, schema } from "@web3-hunter/db";
import { eq } from "drizzle-orm";
import { evaluateRecommendationForMatch } from "./recommendation-store";

export interface DecisionPipelineResult {
  matchesConsidered: number;
  recommendationsCreated: number;
  recommendationsRefreshed: number;
  recommendationsExpired: number;
}

/**
 * Evaluates Recommendation creation, priority refresh, and staleness
 * expiration across every one of a User's Matches — the trigger for
 * "your Matches changed" or "run this periodically," per Milestone 6,
 * the same User-scoped shape `runMatchingPipeline` uses.
 */
export async function runDecisionPipeline(
  userId: string,
  asOf: Date = new Date(),
): Promise<DecisionPipelineResult> {
  const matches = await getDb().select().from(schema.match).where(eq(schema.match.userId, userId));

  const result: DecisionPipelineResult = {
    matchesConsidered: matches.length,
    recommendationsCreated: 0,
    recommendationsRefreshed: 0,
    recommendationsExpired: 0,
  };

  for (const matchRow of matches) {
    const evaluation = await evaluateRecommendationForMatch(userId, matchRow.opportunityId, asOf);
    if (evaluation?.outcome === "created") {
      result.recommendationsCreated += 1;
    } else if (evaluation?.outcome === "refreshed") {
      result.recommendationsRefreshed += 1;
    } else if (evaluation?.outcome === "expired") {
      result.recommendationsExpired += 1;
    }
  }

  return result;
}
