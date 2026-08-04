import { describe, expect, it } from "vitest";
import { evaluateEligibility, listDecisionRules, registerDecisionRule } from "./registry";
import type { DecisionRule, DecisionRuleContext } from "./types";

const CONTEXT: DecisionRuleContext = {
  matchScore: 0.9,
  matchComputedAt: new Date("2026-01-01T00:00:00Z"),
  intelligenceConfidence: 0.9,
  intelligenceAsOf: new Date("2026-01-01T00:00:00Z"),
  opportunityStatus: "scored",
  asOf: new Date("2026-01-01T00:00:00Z"),
};

describe("registry", () => {
  it("returns null (eligible) when every registered rule passes", () => {
    const alwaysPasses: DecisionRule = () => null;
    registerDecisionRule(alwaysPasses);

    expect(evaluateEligibility(CONTEXT)).toBeNull();
  });

  it("returns the first violation found, short-circuiting later rules", () => {
    const calls: string[] = [];
    const failsFirst: DecisionRule = () => {
      calls.push("first");
      return { ruleName: "first", reasonCode: "first-failed", reasonDetails: {} };
    };
    const neverRuns: DecisionRule = () => {
      calls.push("second");
      return null;
    };
    registerDecisionRule(failsFirst);
    registerDecisionRule(neverRuns);

    const violation = evaluateEligibility(CONTEXT);

    expect(violation?.reasonCode).toBe("first-failed");
    expect(calls).toEqual(["first"]);
  });

  it("is open for extension: a newly registered rule is immediately included", () => {
    const before = listDecisionRules().length;
    registerDecisionRule(() => null);
    expect(listDecisionRules()).toHaveLength(before + 1);
  });
});
