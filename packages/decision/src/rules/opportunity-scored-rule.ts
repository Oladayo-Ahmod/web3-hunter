import { registerDecisionRule } from "../registry";
import type { DecisionRule } from "../types";

export const OPPORTUNITY_NOT_SCORED_REASON_CODE = "opportunity-not-scored";

/**
 * The one meaningful "Opportunity closure" check available today:
 * `opportunity` has no archived/closed status yet (see
 * docs/DOMAIN_MODEL.md's Future Extension Points, deferred in Milestone
 * 3), so this rule is a defensive check against an Opportunity that
 * hasn't reached `scored` — not a real closure/archival model.
 */
export const opportunityScoredRule: DecisionRule = (context) => {
  if (context.opportunityStatus === "scored") {
    return null;
  }
  return {
    ruleName: "opportunity-scored",
    reasonCode: OPPORTUNITY_NOT_SCORED_REASON_CODE,
    reasonDetails: { opportunityStatus: context.opportunityStatus },
  };
};

registerDecisionRule(opportunityScoredRule);
