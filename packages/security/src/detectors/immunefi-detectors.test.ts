import { describe, expect, it } from "vitest";
import { doesSignalTypeQualifyForOpportunity } from "../registry";
import type { RecentSecurityTargetEvent, SecuritySignalDetectionContext } from "../types";
import {
  BOUNTY_PROGRAM_OBSERVED,
  BOUNTY_PROGRAM_PAUSED,
  BOUNTY_PROGRAM_RESUMED,
  BOUNTY_SCOPE_EXPANDED,
  bountyProgramObservedDetector,
  bountyProgramPausedDetector,
  bountyProgramResumedDetector,
  bountyScopeExpandedDetector,
} from "./immunefi-detectors";

const SECURITY_TARGET_ID = "019474b4-9a3e-7c3e-9c3e-9c3e9c3e9c3e";

function baseMetadata(overrides: Record<string, unknown> = {}) {
  return {
    slug: "enzyme-onyx",
    project: "Enzyme Onyx",
    ecosystem: ["ETH"],
    launchDate: "2025-09-04T10:00:00.000Z",
    isPaused: false,
    pausedAt: null,
    maxBounty: 200000,
    rewardsPool: 0,
    githubUrl: "https://github.com/x/y",
    websiteUrl: null,
    kyc: false,
    inviteOnly: false,
    assets: [{ id: "asset-1", type: "smart_contract", description: "A", url: null }],
    smartContractAssetIds: ["asset-1"],
    ...overrides,
  };
}

function event(overrides: Partial<RecentSecurityTargetEvent> = {}): RecentSecurityTargetEvent {
  return {
    id: "019474b4-0000-7000-8000-000000000001",
    type: "BountyProgramRecorded",
    occurredAt: new Date("2026-10-09T00:00:00Z"),
    metadata: baseMetadata(),
    ...overrides,
  };
}

const context: SecuritySignalDetectionContext = {
  securityTargetId: SECURITY_TARGET_ID,
  asOf: new Date("2026-10-09T00:00:00Z"),
  recentEvents: [],
};

describe("opportunity-qualification declarations", () => {
  it("BOUNTY_PROGRAM_OBSERVED and BOUNTY_PROGRAM_PAUSED do not qualify on their own", () => {
    expect(doesSignalTypeQualifyForOpportunity(BOUNTY_PROGRAM_OBSERVED)).toBe(false);
    expect(doesSignalTypeQualifyForOpportunity(BOUNTY_PROGRAM_PAUSED)).toBe(false);
  });

  it("BOUNTY_PROGRAM_RESUMED and BOUNTY_SCOPE_EXPANDED each qualify on their own", () => {
    expect(doesSignalTypeQualifyForOpportunity(BOUNTY_PROGRAM_RESUMED)).toBe(true);
    expect(doesSignalTypeQualifyForOpportunity(BOUNTY_SCOPE_EXPANDED)).toBe(true);
  });
});

describe("bountyProgramObservedDetector", () => {
  it("fires on BountyProgramRecorded with higher weight when launchDate is recent", () => {
    const triggeringEvent = event({
      metadata: baseMetadata({ launchDate: "2026-09-20T00:00:00.000Z" }),
    });

    const [candidate] = bountyProgramObservedDetector(triggeringEvent, context);

    expect(candidate?.signalType).toBe(BOUNTY_PROGRAM_OBSERVED);
    expect(candidate?.weight).toBe(0.5);
    expect(candidate?.reasoning).toMatch(/first time by our poll/);
    expect(candidate?.reasoning).not.toMatch(/newly opened/);
  });

  it("fires with lower weight when launchDate is not recent, never claiming the program is newly opened", () => {
    const [candidate] = bountyProgramObservedDetector(event(), context);

    expect(candidate?.weight).toBe(0.3);
    expect(candidate?.reasoning).toMatch(/related but distinct facts/);
  });

  it("does not fire on BountyProgramUpdated", () => {
    expect(
      bountyProgramObservedDetector(event({ type: "BountyProgramUpdated" }), context),
    ).toHaveLength(0);
  });
});

describe("bountyProgramResumedDetector", () => {
  it("fires on a verified paused -> active transition with smart-contract scope present", () => {
    const triggeringEvent = event({
      type: "BountyProgramUpdated",
      metadata: baseMetadata({ isPaused: false, changedFrom: { isPaused: true } }),
    });

    const [candidate] = bountyProgramResumedDetector(triggeringEvent, context);

    expect(candidate?.signalType).toBe(BOUNTY_PROGRAM_RESUMED);
  });

  it("does not fire when resumed but with zero smart-contract assets in scope", () => {
    const triggeringEvent = event({
      type: "BountyProgramUpdated",
      metadata: baseMetadata({
        isPaused: false,
        smartContractAssetIds: [],
        changedFrom: { isPaused: true },
      }),
    });

    expect(bountyProgramResumedDetector(triggeringEvent, context)).toHaveLength(0);
  });

  it("does not fire when the program is still paused", () => {
    const triggeringEvent = event({
      type: "BountyProgramUpdated",
      metadata: baseMetadata({ isPaused: true, changedFrom: { maxBounty: 100000 } }),
    });

    expect(bountyProgramResumedDetector(triggeringEvent, context)).toHaveLength(0);
  });

  it("does not fire on BountyProgramRecorded", () => {
    expect(bountyProgramResumedDetector(event(), context)).toHaveLength(0);
  });
});

describe("bountyProgramPausedDetector", () => {
  it("fires on a verified active -> paused transition", () => {
    const triggeringEvent = event({
      type: "BountyProgramUpdated",
      metadata: baseMetadata({
        isPaused: true,
        pausedAt: "2026-10-09T00:00:00.000Z",
        changedFrom: { isPaused: false },
      }),
    });

    const [candidate] = bountyProgramPausedDetector(triggeringEvent, context);

    expect(candidate?.signalType).toBe(BOUNTY_PROGRAM_PAUSED);
    expect(candidate?.reasoning).toMatch(/paused/);
  });

  it("does not fire when the program is still active", () => {
    const triggeringEvent = event({
      type: "BountyProgramUpdated",
      metadata: baseMetadata({ isPaused: false, changedFrom: { maxBounty: 100000 } }),
    });

    expect(bountyProgramPausedDetector(triggeringEvent, context)).toHaveLength(0);
  });
});

describe("bountyScopeExpandedDetector", () => {
  it("fires when a new smart-contract asset id appears, comparing sets not order or count", () => {
    const triggeringEvent = event({
      type: "BountyProgramUpdated",
      metadata: baseMetadata({
        smartContractAssetIds: ["asset-2", "asset-1"],
        assets: [
          { id: "asset-1", type: "smart_contract", description: "A", url: null },
          { id: "asset-2", type: "smart_contract", description: "B", url: null },
        ],
        changedFrom: { smartContractAssetIds: ["asset-1"] },
      }),
    });

    const [candidate] = bountyScopeExpandedDetector(triggeringEvent, context);

    expect(candidate?.signalType).toBe(BOUNTY_SCOPE_EXPANDED);
    expect(candidate?.reasoning).toMatch(/Added: B/);
  });

  it("does not fire for a website/application asset addition (no smartContractAssetIds change)", () => {
    const triggeringEvent = event({
      type: "BountyProgramUpdated",
      metadata: baseMetadata({
        changedFrom: {
          assets: [{ id: "asset-1", type: "smart_contract", description: "A", url: null }],
        },
      }),
    });

    expect(bountyScopeExpandedDetector(triggeringEvent, context)).toHaveLength(0);
  });

  it("does not fire when only assets were removed (scope shrank, not expanded)", () => {
    const triggeringEvent = event({
      type: "BountyProgramUpdated",
      metadata: baseMetadata({
        smartContractAssetIds: [],
        assets: [],
        changedFrom: {
          smartContractAssetIds: ["asset-1"],
          assets: [{ id: "asset-1", type: "smart_contract", description: "A", url: null }],
        },
      }),
    });

    expect(bountyScopeExpandedDetector(triggeringEvent, context)).toHaveLength(0);
  });

  it("preserves before-and-after evidence naming which assets were added and removed", () => {
    const triggeringEvent = event({
      type: "BountyProgramUpdated",
      metadata: baseMetadata({
        smartContractAssetIds: ["asset-2"],
        assets: [{ id: "asset-2", type: "smart_contract", description: "New Contract", url: null }],
        changedFrom: {
          smartContractAssetIds: ["asset-1"],
          assets: [
            { id: "asset-1", type: "smart_contract", description: "Old Contract", url: null },
          ],
        },
      }),
    });

    const [candidate] = bountyScopeExpandedDetector(triggeringEvent, context);

    expect(candidate?.reasoning).toMatch(/Added: New Contract/);
    expect(candidate?.reasoning).toMatch(/Removed since the previous poll: Old Contract/);
  });

  it("does not fire while the program is paused, even if scope changed", () => {
    const triggeringEvent = event({
      type: "BountyProgramUpdated",
      metadata: baseMetadata({
        isPaused: true,
        smartContractAssetIds: ["asset-1", "asset-2"],
        changedFrom: { smartContractAssetIds: ["asset-1"] },
      }),
    });

    expect(bountyScopeExpandedDetector(triggeringEvent, context)).toHaveLength(0);
  });

  it("does not fire on BountyProgramRecorded (no previous scope to compare against)", () => {
    expect(bountyScopeExpandedDetector(event(), context)).toHaveLength(0);
  });
});
