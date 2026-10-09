import { describe, expect, it } from "vitest";
import { BountyProgramRecorded, BountyProgramUpdated } from "../bounty-program-events";
import { createImmunefiBountyProgramNormalizer } from "./normalize";

const SECURITY_TARGET_ID = "019474b4-9a3e-7c3e-9c3e-9c3e9c3e9c3e";

function bounty(overrides: Record<string, unknown> = {}) {
  return {
    slug: "enzyme-onyx",
    project: "Enzyme Onyx",
    ecosystem: ["ETH"],
    launchDate: "2025-09-04T10:00:00.000Z",
    updatedDate: "2026-10-09T08:02:03.438Z",
    isPaused: false,
    pausedAt: null,
    maxBounty: 200000,
    rewardsPool: 0,
    githubUrl: "https://github.com/enzymefinance/protocol-onyx",
    websiteUrl: null,
    kyc: false,
    inviteOnly: false,
    assets: [
      {
        id: "asset-1",
        url: "https://github.com/x/y/A.sol",
        type: "smart_contract",
        description: "A",
      },
    ],
    ...overrides,
  };
}

describe("createImmunefiBountyProgramNormalizer", () => {
  const normalize = createImmunefiBountyProgramNormalizer(SECURITY_TARGET_ID);

  it("produces a BountyProgramRecorded event when there is no previous payload, using updatedDate as occurredAt", () => {
    const result = normalize({
      rawRecordId: "raw-1",
      collectorId: "collector-1",
      payload: bounty(),
      fetchedAt: new Date("2099-01-01T00:00:00Z"),
      previousPayload: null,
    });

    expect(result?.type).toBe(BountyProgramRecorded.name);
    expect(result?.relatedEntityType).toBe("security_target");
    expect(result?.relatedEntityId).toBe(SECURITY_TARGET_ID);
    expect(result?.occurredAt).toEqual(new Date("2026-10-09T08:02:03.438Z"));
    expect(result?.metadata).toMatchObject({
      slug: "enzyme-onyx",
      project: "Enzyme Onyx",
      smartContractAssetIds: ["asset-1"],
    });
  });

  it("produces null when the previous payload is identical", () => {
    const result = normalize({
      rawRecordId: "raw-2",
      collectorId: "collector-1",
      payload: bounty(),
      fetchedAt: new Date(),
      previousPayload: bounty(),
    });

    expect(result).toBeNull();
  });

  it("produces a BountyProgramUpdated event citing exactly which fields changed on pause", () => {
    const result = normalize({
      rawRecordId: "raw-3",
      collectorId: "collector-1",
      payload: bounty({ isPaused: true, pausedAt: "2026-10-09T00:00:00.000Z" }),
      fetchedAt: new Date(),
      previousPayload: bounty(),
    });

    expect(result?.type).toBe(BountyProgramUpdated.name);
    expect(result?.metadata).toMatchObject({
      isPaused: true,
      changedFrom: { isPaused: false, pausedAt: null },
    });
  });

  it("includes smartContractAssetIds in changedFrom only when a smart-contract asset id was actually added or removed", () => {
    const result = normalize({
      rawRecordId: "raw-4",
      collectorId: "collector-1",
      payload: bounty({
        assets: [
          { id: "asset-1", url: "x", type: "smart_contract", description: "A" },
          { id: "asset-2", url: "y", type: "smart_contract", description: "B" },
        ],
      }),
      fetchedAt: new Date(),
      previousPayload: bounty(),
    });

    const changedFrom = (result?.metadata as { changedFrom: Record<string, unknown> }).changedFrom;
    expect(changedFrom.smartContractAssetIds).toEqual(["asset-1"]);
  });

  it("does not report smartContractAssetIds as changed when only a website/application asset is added", () => {
    const result = normalize({
      rawRecordId: "raw-5",
      collectorId: "collector-1",
      payload: bounty({
        assets: [
          { id: "asset-1", url: "x", type: "smart_contract", description: "A" },
          {
            id: "asset-web",
            url: "https://example.com",
            type: "websites_and_applications",
            description: null,
          },
        ],
      }),
      fetchedAt: new Date(),
      previousPayload: bounty(),
    });

    const changedFrom = (result?.metadata as { changedFrom: Record<string, unknown> }).changedFrom;
    expect(changedFrom.smartContractAssetIds).toBeUndefined();
    // The full `assets` array did change (a new asset was added), even
    // though the smart-contract-only summary didn't — both facts are
    // preserved, each in its own field.
    expect(changedFrom.assets).toBeDefined();
  });

  it("does not report smartContractAssetIds as changed when an existing asset's description/revision changes but its id set is unchanged", () => {
    const result = normalize({
      rawRecordId: "raw-6",
      collectorId: "collector-1",
      payload: bounty({
        assets: [{ id: "asset-1", url: "x", type: "smart_contract", description: "A (renamed)" }],
      }),
      fetchedAt: new Date(),
      previousPayload: bounty(),
    });

    const changedFrom = (result?.metadata as { changedFrom: Record<string, unknown> }).changedFrom;
    expect(changedFrom.smartContractAssetIds).toBeUndefined();
  });

  it("does not assume updatedDate is monotonically increasing: an earlier updatedDate than the previous poll still diffs and normalizes correctly", () => {
    const result = normalize({
      rawRecordId: "raw-7",
      collectorId: "collector-1",
      payload: bounty({ updatedDate: "2020-01-01T00:00:00.000Z", maxBounty: 300000 }),
      fetchedAt: new Date(),
      previousPayload: bounty(),
    });

    expect(result?.type).toBe(BountyProgramUpdated.name);
    expect(result?.occurredAt).toEqual(new Date("2020-01-01T00:00:00.000Z"));
    expect(result?.metadata).toMatchObject({
      maxBounty: 300000,
      changedFrom: { maxBounty: 200000 },
    });
  });

  it("maps a missing githubUrl/websiteUrl/pausedAt to null", () => {
    const result = normalize({
      rawRecordId: "raw-8",
      collectorId: "collector-1",
      payload: bounty({ githubUrl: undefined, websiteUrl: undefined, pausedAt: undefined }),
      fetchedAt: new Date(),
      previousPayload: null,
    });

    expect(result?.metadata).toMatchObject({ githubUrl: null, websiteUrl: null, pausedAt: null });
  });
});
