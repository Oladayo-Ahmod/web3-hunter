import { describe, expect, it } from "vitest";
import { countDistinctTriggeringEvents, securityTargetPriorityTier } from "./security-priority";

describe("securityTargetPriorityTier", () => {
  it("returns Tier C for an empty signal-type list", () => {
    const result = securityTargetPriorityTier([]);
    expect(result.tier).toBe("C");
    expect(result.qualifyingSignalTypes).toEqual([]);
  });

  it("returns Tier C when only non-qualifying signal types are present", () => {
    const result = securityTargetPriorityTier(["new-protocol", "bounty-program-observed"]);
    expect(result.tier).toBe("C");
    expect(result.qualifyingSignalTypes).toEqual([]);
  });

  it("returns Tier B for a qualifying type that does not name a specific artifact", () => {
    const result = securityTargetPriorityTier(["tvl-growth"]);
    expect(result.tier).toBe("B");
    expect(result.qualifyingSignalTypes).toEqual(["tvl-growth"]);
  });

  it("returns Tier A for a qualifying type that names a specific artifact", () => {
    const result = securityTargetPriorityTier(["bounty-scope-expanded"]);
    expect(result.tier).toBe("A");
    expect(result.qualifyingSignalTypes).toEqual(["bounty-scope-expanded"]);
  });

  it("prefers Tier A over Tier B when both kinds of qualifying signal are present", () => {
    const result = securityTargetPriorityTier(["tvl-growth", "bounty-scope-expanded"]);
    expect(result.tier).toBe("A");
  });

  it("deduplicates and sorts signal types so the result never depends on input order", () => {
    const a = securityTargetPriorityTier(["tvl-growth", "audit-coverage-gap", "tvl-growth"]);
    const b = securityTargetPriorityTier(["audit-coverage-gap", "tvl-growth"]);
    expect(a).toEqual(b);
    expect(a.qualifyingSignalTypes).toEqual(["audit-coverage-gap", "tvl-growth"]);
  });

  it("never lets an unregistered signal type qualify or elevate the tier", () => {
    const result = securityTargetPriorityTier(["__not-a-real-signal-type__"]);
    expect(result.tier).toBe("C");
  });
});

describe("countDistinctTriggeringEvents", () => {
  it("returns 0 for no signals", () => {
    expect(countDistinctTriggeringEvents([])).toBe(0);
  });

  it("counts one signal's single event as 1", () => {
    expect(countDistinctTriggeringEvents([{ sourceEventIds: ["e1"] }])).toBe(1);
  });

  it("collapses two signals sharing the same triggering event to 1", () => {
    const count = countDistinctTriggeringEvents([
      { sourceEventIds: ["e1"] },
      { sourceEventIds: ["e1"] },
    ]);
    expect(count).toBe(1);
  });

  it("counts two signals with genuinely separate triggering events as 2", () => {
    const count = countDistinctTriggeringEvents([
      { sourceEventIds: ["e1"] },
      { sourceEventIds: ["e2"] },
    ]);
    expect(count).toBe(2);
  });

  it("counts every distinct id across a signal with multiple source events", () => {
    const count = countDistinctTriggeringEvents([
      { sourceEventIds: ["e1", "e2"] },
      { sourceEventIds: ["e2", "e3"] },
    ]);
    expect(count).toBe(3);
  });
});
