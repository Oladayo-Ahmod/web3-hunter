import { MIN_RELEVANCE_THRESHOLD } from "../constants";
import { registerDecisionRule } from "../registry";
import type { DecisionRule } from "../types";

export const RELEVANCE_THRESHOLD_REASON_CODE = "match-score-below-threshold";

export const relevanceThresholdRule: DecisionRule = (context) => {
  if (context.matchScore >= MIN_RELEVANCE_THRESHOLD) {
    return null;
  }
  return {
    ruleName: "relevance-threshold",
    reasonCode: RELEVANCE_THRESHOLD_REASON_CODE,
    reasonDetails: { matchScore: context.matchScore, threshold: MIN_RELEVANCE_THRESHOLD },
  };
};

registerDecisionRule(relevanceThresholdRule);
