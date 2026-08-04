import { describe, expect, it } from "vitest";
import { computeCompanyIntelligence, intelligenceStatesEqual } from "./intelligence";
import type { SignalSummary } from "./types";

const ASOF = new Date("2026-03-01T00:00:00Z");
const DAY_MS = 24 * 60 * 60 * 1000;

function daysBefore(days: number): Date {
  return new Date(ASOF.getTime() - days * DAY_MS);
}

function signal(overrides: Partial<SignalSummary>): SignalSummary {
  return {
    id: "signal-id",
    signalType: "test-signal",
    weight: 0.5,
    detectedAt: ASOF,
    ...overrides,
  };
}

describe("computeCompanyIntelligence", () => {
  it("returns insufficient-data with zero confidence when there are no signals", () => {
    const result = computeCompanyIntelligence([], ASOF);
    expect(result).toEqual({
      trend: "insufficient-data",
      confidence: 0,
      signalCount: 0,
      lastSignalAt: null,
    });
  });

  it("returns insufficient-data trend with a single signal", () => {
    const result = computeCompanyIntelligence([signal({ detectedAt: daysBefore(5) })], ASOF);
    expect(result.trend).toBe("insufficient-data");
    expect(result.signalCount).toBe(1);
  });

  it("detects an increasing trend when recent weight substantially exceeds prior weight", () => {
    const signals = [
      signal({ id: "a", weight: 0.3, detectedAt: daysBefore(45) }), // prior window
      signal({ id: "b", weight: 0.6, detectedAt: daysBefore(10) }), // recent window
    ];
    expect(computeCompanyIntelligence(signals, ASOF).trend).toBe("increasing");
  });

  it("detects a decreasing trend when recent weight is substantially below prior weight", () => {
    const signals = [
      signal({ id: "a", weight: 0.6, detectedAt: daysBefore(45) }),
      signal({ id: "b", weight: 0.2, detectedAt: daysBefore(10) }),
    ];
    expect(computeCompanyIntelligence(signals, ASOF).trend).toBe("decreasing");
  });

  it("detects a stable trend when recent and prior weight are comparable", () => {
    const signals = [
      signal({ id: "a", weight: 0.5, detectedAt: daysBefore(45) }),
      signal({ id: "b", weight: 0.5, detectedAt: daysBefore(10) }),
    ];
    expect(computeCompanyIntelligence(signals, ASOF).trend).toBe("stable");
  });

  it("treats any recent activity with zero prior activity as increasing", () => {
    const signals = [
      signal({ id: "a", weight: 0.4, detectedAt: daysBefore(10) }),
      signal({ id: "b", weight: 0.4, detectedAt: daysBefore(5) }),
    ];
    expect(computeCompanyIntelligence(signals, ASOF).trend).toBe("increasing");
  });

  it("computes confidence from the average weight and volume of fresh signals", () => {
    const signals = [
      signal({ id: "a", weight: 0.5, detectedAt: daysBefore(10) }),
      signal({ id: "b", weight: 0.5, detectedAt: daysBefore(5) }),
    ];
    // averageWeight 0.5 * volumeFactor (2/5) = 0.2
    expect(computeCompanyIntelligence(signals, ASOF).confidence).toBe(0.2);
  });

  it("excludes signals older than the freshness window from confidence", () => {
    const signals = [signal({ id: "a", weight: 0.9, detectedAt: daysBefore(120) })];
    expect(computeCompanyIntelligence(signals, ASOF).confidence).toBe(0);
  });

  it("reports the most recent signal's timestamp as lastSignalAt regardless of input order", () => {
    const latest = daysBefore(1);
    const signals = [
      signal({ id: "a", detectedAt: latest }),
      signal({ id: "b", detectedAt: daysBefore(20) }),
    ];
    expect(computeCompanyIntelligence(signals, ASOF).lastSignalAt).toEqual(latest);
  });

  it("is deterministic: the same signals and asOf always produce the same state", () => {
    const signals = [
      signal({ id: "a", weight: 0.4, detectedAt: daysBefore(15) }),
      signal({ id: "b", weight: 0.6, detectedAt: daysBefore(3) }),
    ];
    const first = computeCompanyIntelligence(signals, ASOF);
    const second = computeCompanyIntelligence([...signals], new Date(ASOF.getTime()));
    expect(second).toEqual(first);
  });
});

describe("intelligenceStatesEqual", () => {
  it("treats identical states as equal", () => {
    const state = { trend: "stable" as const, confidence: 0.3, signalCount: 2, lastSignalAt: ASOF };
    expect(intelligenceStatesEqual(state, { ...state })).toBe(true);
  });

  it("treats states with different confidence as unequal", () => {
    const a = { trend: "stable" as const, confidence: 0.3, signalCount: 2, lastSignalAt: ASOF };
    const b = { ...a, confidence: 0.4 };
    expect(intelligenceStatesEqual(a, b)).toBe(false);
  });

  it("treats null lastSignalAt on both sides as equal", () => {
    const a = {
      trend: "insufficient-data" as const,
      confidence: 0,
      signalCount: 0,
      lastSignalAt: null,
    };
    expect(intelligenceStatesEqual(a, { ...a })).toBe(true);
  });
});
