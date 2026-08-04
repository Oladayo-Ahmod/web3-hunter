import { describe, expect, it } from "vitest";
import { meetsOpportunityThreshold } from "./opportunity-detection";
import type { CompanyIntelligenceState } from "./types";

function intelligence(overrides: Partial<CompanyIntelligenceState>): CompanyIntelligenceState {
  return {
    trend: "increasing",
    confidence: 0.6,
    signalCount: 3,
    lastSignalAt: new Date(),
    ...overrides,
  };
}

describe("meetsOpportunityThreshold", () => {
  it("is met when confidence, signal count, and trend all qualify", () => {
    expect(meetsOpportunityThreshold(intelligence({}))).toBe(true);
  });

  it("is not met when confidence is below the threshold", () => {
    expect(meetsOpportunityThreshold(intelligence({ confidence: 0.1 }))).toBe(false);
  });

  it("is not met when there are too few signals", () => {
    expect(meetsOpportunityThreshold(intelligence({ signalCount: 1 }))).toBe(false);
  });

  it("is not met when the trend is decreasing, even with high confidence", () => {
    expect(meetsOpportunityThreshold(intelligence({ trend: "decreasing", confidence: 0.9 }))).toBe(
      false,
    );
  });

  it("is met with a stable trend, given sufficient confidence and signal count", () => {
    expect(meetsOpportunityThreshold(intelligence({ trend: "stable" }))).toBe(true);
  });
});
