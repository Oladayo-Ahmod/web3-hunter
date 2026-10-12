import { describe, expect, it } from "vitest";
import {
  countDistinctTriggeringEvents,
  deriveResearchReadiness,
  deriveResearchRoute,
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

  it("includes a concrete example asset in nextAction when one is supplied", () => {
    const result = deriveResearchReadiness({
      isActionable: true,
      actionableAssetCount: 3,
      qualifyingSignalTypes: [],
      exampleAsset: { description: "Vault.sol", url: "https://github.com/acme/Vault.sol" },
    });
    expect(result.nextAction).toMatch(/3 smart-contract asset/i);
    expect(result.nextAction).toContain('"Vault.sol"');
    expect(result.nextAction).toContain("https://github.com/acme/Vault.sol");
  });

  it("omits the example clause entirely when no example asset is supplied", () => {
    const withNull = deriveResearchReadiness({
      isActionable: true,
      actionableAssetCount: 3,
      qualifyingSignalTypes: [],
      exampleAsset: null,
    });
    const withoutField = deriveResearchReadiness({
      isActionable: true,
      actionableAssetCount: 3,
      qualifyingSignalTypes: [],
    });
    expect(withNull.nextAction).not.toContain("for example");
    expect(withoutField.nextAction).not.toContain("for example");
    expect(withNull.nextAction).toBe(withoutField.nextAction);
  });

  it("omits the example clause when the example asset has neither description nor url", () => {
    const result = deriveResearchReadiness({
      isActionable: true,
      actionableAssetCount: 1,
      qualifyingSignalTypes: [],
      exampleAsset: { description: null, url: null },
    });
    expect(result.nextAction).not.toContain("for example");
  });

  it("never fabricates a description, naming only the url when description is missing", () => {
    const result = deriveResearchReadiness({
      isActionable: true,
      actionableAssetCount: 1,
      qualifyingSignalTypes: [],
      exampleAsset: { description: null, url: "https://github.com/acme/contracts" },
    });
    expect(result.nextAction).toContain("for example");
    expect(result.nextAction).toContain("https://github.com/acme/contracts");
    expect(result.nextAction).toContain("one of the listed assets");
  });
});

describe("deriveResearchRoute", () => {
  it("is verified-bounty and reuses readiness's nextAction verbatim when readiness is ready", () => {
    const result = deriveResearchRoute({
      readinessStatus: "ready",
      readinessNextAction: "Review the 2 smart-contract asset(s) currently in scope.",
      repositoryUrl: null,
      websiteUrl: null,
    });
    expect(result.route).toBe("verified-bounty");
    expect(result.nextAction).toBe("Review the 2 smart-contract asset(s) currently in scope.");
  });

  it("falls back to a generic bounty nextAction if readiness somehow supplied none", () => {
    const result = deriveResearchRoute({
      readinessStatus: "ready",
      readinessNextAction: null,
      repositoryUrl: null,
      websiteUrl: null,
    });
    expect(result.route).toBe("verified-bounty");
    expect(result.nextAction).toMatch(/active bounty program/i);
  });

  it("is repository-research when not ready but a repository is on record", () => {
    const result = deriveResearchRoute({
      readinessStatus: "insufficient-evidence",
      readinessNextAction: null,
      repositoryUrl: "https://github.com/acme/contracts",
      websiteUrl: null,
    });
    expect(result.route).toBe("repository-research");
    expect(result.nextAction).toContain("https://github.com/acme/contracts");
  });

  it("is repository-research when not ready but only a website is on record", () => {
    const result = deriveResearchRoute({
      readinessStatus: "no-current-route",
      readinessNextAction: null,
      repositoryUrl: null,
      websiteUrl: "https://acme.xyz",
    });
    expect(result.route).toBe("repository-research");
    expect(result.nextAction).toContain("https://acme.xyz");
  });

  it("prefers the repository url over the website url when both are present", () => {
    const result = deriveResearchRoute({
      readinessStatus: "no-current-route",
      readinessNextAction: null,
      repositoryUrl: "https://github.com/acme/contracts",
      websiteUrl: "https://acme.xyz",
    });
    expect(result.nextAction).toContain("https://github.com/acme/contracts");
    expect(result.nextAction).not.toContain("https://acme.xyz");
  });

  it("is needs-discovery when not ready and neither a repository nor a website is on record", () => {
    const result = deriveResearchRoute({
      readinessStatus: "no-current-route",
      readinessNextAction: null,
      repositoryUrl: null,
      websiteUrl: null,
    });
    expect(result.route).toBe("needs-discovery");
    expect(result.nextAction).toMatch(/search for its official documentation/i);
  });
});
