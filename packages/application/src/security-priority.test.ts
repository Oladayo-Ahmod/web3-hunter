import { describe, expect, it } from "vitest";
import {
  countDistinctTriggeringEvents,
  deriveResearchReadiness,
  securityTargetPriorityTier,
} from "./security-priority";

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

describe("deriveResearchReadiness", () => {
  it("is ready when actionable, even with no qualifying signal at all", () => {
    const result = deriveResearchReadiness({
      isActionable: true,
      actionableAssetCount: 2,
      qualifyingSignalTypes: [],
    });
    expect(result.status).toBe("ready");
    expect(result.nextAction).toMatch(/2 smart-contract asset/i);
  });

  it("is ready when actionable, regardless of a qualifying signal also being present", () => {
    const result = deriveResearchReadiness({
      isActionable: true,
      actionableAssetCount: 1,
      qualifyingSignalTypes: ["bounty-scope-expanded"],
    });
    expect(result.status).toBe("ready");
    expect(result.nextAction).toMatch(/1 smart-contract asset/i);
  });

  it("is insufficient-evidence (not ready) for a qualifying signal with no currently actionable bounty", () => {
    const result = deriveResearchReadiness({
      isActionable: false,
      actionableAssetCount: 0,
      qualifyingSignalTypes: ["tvl-growth"],
    });
    expect(result.status).toBe("insufficient-evidence");
    expect(result.reason).toMatch(/tvl-growth/);
    expect(result.nextAction).toBeNull();
  });

  it("is no-current-route (not insufficient-evidence) when there is no qualifying signal at all", () => {
    const result = deriveResearchReadiness({
      isActionable: false,
      actionableAssetCount: 0,
      qualifyingSignalTypes: [],
    });
    expect(result.status).toBe("no-current-route");
    expect(result.nextAction).toBeNull();
    // Explicitly disclaims insecurity, per spec — never silent about it,
    // and never a claim that research here is impossible.
    expect(result.reason).toMatch(/does not mean.*insecure/i);
  });

  it("picks a deterministic signal type for the reason regardless of input order", () => {
    const a = deriveResearchReadiness({
      isActionable: false,
      actionableAssetCount: 0,
      qualifyingSignalTypes: ["tvl-growth", "audit-coverage-gap"],
    });
    const b = deriveResearchReadiness({
      isActionable: false,
      actionableAssetCount: 0,
      qualifyingSignalTypes: ["audit-coverage-gap", "tvl-growth"],
    });
    expect(a).toEqual(b);
    expect(a.reason).toMatch(/audit-coverage-gap/);
  });

  it("never populates nextAction outside of ready", () => {
    const insufficient = deriveResearchReadiness({
      isActionable: false,
      actionableAssetCount: 0,
      qualifyingSignalTypes: ["tvl-growth"],
    });
    const noRoute = deriveResearchReadiness({
      isActionable: false,
      actionableAssetCount: 0,
      qualifyingSignalTypes: [],
    });
    expect(insufficient.nextAction).toBeNull();
    expect(noRoute.nextAction).toBeNull();
  });
});
