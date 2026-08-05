import type { RecommendationExplanationContext } from "./types";

/** Bumped only when this prompt's shape changes meaningfully — see `promptVersion` on the artifact tables. */
export const RECOMMENDATION_EXPLANATION_PROMPT_VERSION = 1;

export function buildRecommendationExplanationPrompt(
  context: RecommendationExplanationContext,
): string {
  return [
    "You are explaining, in plain language, why a hiring Opportunity was recommended to a Web3 engineer.",
    "Write 2-3 sentences. Ground every claim in the facts below — never invent a fact, a company detail, or a reason not listed here.",
    "",
    `Company: ${context.companyName}`,
    `Opportunity type: ${context.opportunityType}`,
    `Match score: ${context.matchScore.toFixed(2)} (reasoning: ${context.matchReasoning})`,
    `Matched Skills: ${context.matchedSkillNames.join(", ") || "none listed"}`,
    `Company Intelligence confidence: ${context.intelligenceConfidence.toFixed(2)}, trend: ${context.intelligenceTrend}`,
    `Recommendation priority: ${context.priority.toFixed(2)}`,
    "",
    "Write the explanation now, addressed directly to the engineer, in plain text with no markup.",
  ].join("\n");
}
