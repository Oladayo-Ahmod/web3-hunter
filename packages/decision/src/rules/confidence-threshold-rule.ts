import { MIN_CONFIDENCE_THRESHOLD } from "../constants";
import { registerDecisionRule } from "../registry";
import type { DecisionRule } from "../types";

export const CONFIDENCE_THRESHOLD_REASON_CODE = "intelligence-confidence-below-threshold";

export const confidenceThresholdRule: DecisionRule = (context) => {
  if (context.intelligenceConfidence >= MIN_CONFIDENCE_THRESHOLD) {
    return null;
  }
  return {
    ruleName: "confidence-threshold",
    reasonCode: CONFIDENCE_THRESHOLD_REASON_CODE,
    reasonDetails: {
      intelligenceConfidence: context.intelligenceConfidence,
      threshold: MIN_CONFIDENCE_THRESHOLD,
    },
  };
};

registerDecisionRule(confidenceThresholdRule);
