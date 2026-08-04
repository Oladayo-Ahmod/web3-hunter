import type { DecisionRule, DecisionRuleContext, DecisionRuleViolation } from "./types";

const rules: DecisionRule[] = [];

/**
 * Registers a Decision Rule to be run by `evaluateEligibility` — the same
 * open-registration pattern `packages/scoring`'s `registerSignalDetector`
 * and `packages/classification`'s `registerSkillClassifier` use. Adding a
 * new eligibility gate (or removing one) never requires modifying the
 * engine that runs them.
 */
export function registerDecisionRule(rule: DecisionRule): void {
  rules.push(rule);
}

export function listDecisionRules(): readonly DecisionRule[] {
  return rules;
}

/**
 * Runs every registered rule against the context and returns the first
 * violation found, or `null` if every rule passed — i.e. the Match is
 * eligible for a new Recommendation. AND/veto semantics: unlike Signal
 * detectors (independent contributions), every Decision Rule must agree.
 */
export function evaluateEligibility(context: DecisionRuleContext): DecisionRuleViolation | null {
  for (const rule of rules) {
    const violation = rule(context);
    if (violation) {
      return violation;
    }
  }
  return null;
}
