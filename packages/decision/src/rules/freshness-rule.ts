import { FRESHNESS_WINDOW_DAYS } from "../constants";
import { registerDecisionRule } from "../registry";
import type { DecisionRule } from "../types";

export const FRESHNESS_REASON_CODE = "intelligence-stale";

const DAY_MS = 24 * 60 * 60 * 1000;

export const freshnessRule: DecisionRule = (context) => {
  const ageDays = (context.asOf.getTime() - context.intelligenceAsOf.getTime()) / DAY_MS;
  if (ageDays <= FRESHNESS_WINDOW_DAYS) {
    return null;
  }
  return {
    ruleName: "freshness",
    reasonCode: FRESHNESS_REASON_CODE,
    reasonDetails: { ageDays: Math.round(ageDays), windowDays: FRESHNESS_WINDOW_DAYS },
  };
};

registerDecisionRule(freshnessRule);
