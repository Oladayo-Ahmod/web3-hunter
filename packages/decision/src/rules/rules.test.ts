import { describe, expect, it } from "vitest";
import {
  MIN_CONFIDENCE_THRESHOLD,
  MIN_RELEVANCE_THRESHOLD,
  FRESHNESS_WINDOW_DAYS,
} from "../constants";
import type { DecisionRuleContext } from "../types";
import {
  CONFIDENCE_THRESHOLD_REASON_CODE,
  confidenceThresholdRule,
} from "./confidence-threshold-rule";
import { FRESHNESS_REASON_CODE, freshnessRule } from "./freshness-rule";
import {
  OPPORTUNITY_NOT_SCORED_REASON_CODE,
  opportunityScoredRule,
} from "./opportunity-scored-rule";
import {
  RELEVANCE_THRESHOLD_REASON_CODE,
  relevanceThresholdRule,
} from "./relevance-threshold-rule";

const ASOF = new Date("2026-03-01T00:00:00Z");

const CONTEXT: DecisionRuleContext = {
  matchScore: 0.9,
  matchComputedAt: ASOF,
  intelligenceConfidence: 0.9,
  intelligenceAsOf: ASOF,
  opportunityStatus: "scored",
  asOf: ASOF,
};

describe("relevanceThresholdRule", () => {
  it("passes at or above the threshold", () => {
    expect(relevanceThresholdRule({ ...CONTEXT, matchScore: MIN_RELEVANCE_THRESHOLD })).toBeNull();
  });

  it("fails below the threshold, citing the reason code", () => {
    const violation = relevanceThresholdRule({
      ...CONTEXT,
      matchScore: MIN_RELEVANCE_THRESHOLD - 0.01,
    });
    expect(violation?.reasonCode).toBe(RELEVANCE_THRESHOLD_REASON_CODE);
  });
});

describe("confidenceThresholdRule", () => {
  it("passes at or above the threshold", () => {
    expect(
      confidenceThresholdRule({ ...CONTEXT, intelligenceConfidence: MIN_CONFIDENCE_THRESHOLD }),
    ).toBeNull();
  });

  it("fails below the threshold, citing the reason code", () => {
    const violation = confidenceThresholdRule({
      ...CONTEXT,
      intelligenceConfidence: MIN_CONFIDENCE_THRESHOLD - 0.01,
    });
    expect(violation?.reasonCode).toBe(CONFIDENCE_THRESHOLD_REASON_CODE);
  });
});

describe("freshnessRule", () => {
  it("passes within the freshness window", () => {
    expect(
      freshnessRule({
        ...CONTEXT,
        intelligenceAsOf: new Date(ASOF.getTime() - FRESHNESS_WINDOW_DAYS * 24 * 60 * 60 * 1000),
      }),
    ).toBeNull();
  });

  it("fails outside the freshness window, citing the reason code", () => {
    const violation = freshnessRule({
      ...CONTEXT,
      intelligenceAsOf: new Date(
        ASOF.getTime() - (FRESHNESS_WINDOW_DAYS + 1) * 24 * 60 * 60 * 1000,
      ),
    });
    expect(violation?.reasonCode).toBe(FRESHNESS_REASON_CODE);
  });
});

describe("opportunityScoredRule", () => {
  it("passes when the Opportunity is scored", () => {
    expect(opportunityScoredRule({ ...CONTEXT, opportunityStatus: "scored" })).toBeNull();
  });

  it("fails when the Opportunity is only detected, citing the reason code", () => {
    const violation = opportunityScoredRule({ ...CONTEXT, opportunityStatus: "detected" });
    expect(violation?.reasonCode).toBe(OPPORTUNITY_NOT_SCORED_REASON_CODE);
  });
});
