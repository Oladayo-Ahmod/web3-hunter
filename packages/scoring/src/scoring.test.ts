import { describe, expect, it } from "vitest";
import { computeOpportunityScore } from "./scoring";
import type { CompanyIntelligenceState, SignalSummary } from "./types";

const INTELLIGENCE: CompanyIntelligenceState = {
  trend: "increasing",
  confidence: 0.6,
  signalCount: 2,
  lastSignalAt: new Date("2026-03-01T00:00:00Z"),
};

function signal(weight: number): SignalSummary {
  return {
    id: "signal-id",
    signalType: "test-signal",
    weight,
    detectedAt: new Date("2026-03-01T00:00:00Z"),
  };
}

describe("computeOpportunityScore", () => {
  it("returns a score within [0, 1]", () => {
    const { score } = computeOpportunityScore([signal(0.8), signal(0.6)], INTELLIGENCE);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it("is deterministic: the same signals and intelligence always produce the same score", () => {
    const signals = [signal(0.5), signal(0.7)];
    const first = computeOpportunityScore(signals, INTELLIGENCE);
    const second = computeOpportunityScore([...signals], { ...INTELLIGENCE });
    expect(second).toEqual(first);
  });

  it("increases as signal weight increases, holding intelligence constant", () => {
    const low = computeOpportunityScore([signal(0.2)], INTELLIGENCE);
    const high = computeOpportunityScore([signal(0.9)], INTELLIGENCE);
    expect(high.score).toBeGreaterThan(low.score);
  });

  it("increases as intelligence confidence increases, holding signals constant", () => {
    const signals = [signal(0.5)];
    const lowConfidence = computeOpportunityScore(signals, { ...INTELLIGENCE, confidence: 0.1 });
    const highConfidence = computeOpportunityScore(signals, { ...INTELLIGENCE, confidence: 0.9 });
    expect(highConfidence.score).toBeGreaterThan(lowConfidence.score);
  });

  it("returns a score of 0 with no signals and zero confidence", () => {
    const { score } = computeOpportunityScore([], { ...INTELLIGENCE, confidence: 0 });
    expect(score).toBe(0);
  });

  it("includes a human-readable reasoning string citing the inputs", () => {
    const { reasoning } = computeOpportunityScore([signal(0.5)], INTELLIGENCE);
    expect(reasoning).toContain("1 Signal");
    expect(reasoning).toContain(INTELLIGENCE.trend);
  });
});
