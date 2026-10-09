import { describe, expect, it } from "vitest";
import { doesSignalTypeQualifyForOpportunity } from "../registry";
import type { RecentSecurityTargetEvent, SecuritySignalDetectionContext } from "../types";
import {
  AUDIT_COVERAGE_GAP,
  NEW_PROTOCOL,
  TVL_GROWTH,
  auditCoverageGapDetector,
  newProtocolDetector,
  tvlGrowthDetector,
} from "./defillama-detectors";

describe("opportunity-qualification declarations", () => {
  it("NEW_PROTOCOL does not qualify a Security Opportunity on its own", () => {
    expect(doesSignalTypeQualifyForOpportunity(NEW_PROTOCOL)).toBe(false);
  });

  it("TVL_GROWTH and AUDIT_COVERAGE_GAP each qualify a Security Opportunity on their own", () => {
    expect(doesSignalTypeQualifyForOpportunity(TVL_GROWTH)).toBe(true);
    expect(doesSignalTypeQualifyForOpportunity(AUDIT_COVERAGE_GAP)).toBe(true);
  });
});

const SECURITY_TARGET_ID = "019474b4-9a3e-7c3e-9c3e-9c3e9c3e9c3e";

function event(overrides: Partial<RecentSecurityTargetEvent> = {}): RecentSecurityTargetEvent {
  return {
    id: "019474b4-0000-7000-8000-000000000001",
    type: "ProtocolSnapshotRecorded",
    occurredAt: new Date("2026-03-01T00:00:00Z"),
    metadata: {
      slug: "aave",
      name: "Aave",
      category: "Lending",
      tvl: 10_000_000,
      change1d: 0,
      change7d: 0,
      listedAt: null,
      audits: "2",
      auditLinks: [],
      chains: ["Ethereum"],
    },
    ...overrides,
  };
}

const context: SecuritySignalDetectionContext = {
  securityTargetId: SECURITY_TARGET_ID,
  asOf: new Date("2026-03-01T00:00:00Z"),
  recentEvents: [],
};

describe("newProtocolDetector", () => {
  it("fires on ProtocolSnapshotRecorded with higher weight when listedAt is recent", () => {
    const triggeringEvent = event({
      metadata: {
        ...(event().metadata as Record<string, unknown>),
        listedAt: Math.floor(new Date("2026-02-20T00:00:00Z").getTime() / 1000),
      },
    });

    const [candidate] = newProtocolDetector(triggeringEvent, context);

    expect(candidate?.signalType).toBe(NEW_PROTOCOL);
    expect(candidate?.weight).toBe(0.5);
    expect(candidate?.reasoning).toMatch(/first time by our DefiLlama poll/);
    expect(candidate?.reasoning).toMatch(/within the last 30 days/);
  });

  it("fires with lower weight when listedAt is absent, without conflating the two facts", () => {
    const [candidate] = newProtocolDetector(event(), context);

    expect(candidate?.weight).toBe(0.3);
    expect(candidate?.reasoning).toMatch(/does not report a listedAt timestamp/);
    expect(candidate?.reasoning).toMatch(/related but distinct facts/);
  });

  it("fires with lower weight when listedAt exists but is not recent", () => {
    const triggeringEvent = event({
      metadata: {
        ...(event().metadata as Record<string, unknown>),
        listedAt: Math.floor(new Date("2020-01-01T00:00:00Z").getTime() / 1000),
      },
    });

    const [candidate] = newProtocolDetector(triggeringEvent, context);

    expect(candidate?.weight).toBe(0.3);
    expect(candidate?.reasoning).toMatch(/not within the last 30 days/);
  });

  it("does not fire on ProtocolSnapshotUpdated", () => {
    const candidates = newProtocolDetector(event({ type: "ProtocolSnapshotUpdated" }), context);
    expect(candidates).toHaveLength(0);
  });
});

describe("tvlGrowthDetector", () => {
  it("fires when TVL grows above both the absolute floor and the percent floor", () => {
    const triggeringEvent = event({
      type: "ProtocolSnapshotUpdated",
      metadata: {
        ...(event().metadata as Record<string, unknown>),
        tvl: 10_000_000,
        changedFrom: { tvl: 7_000_000 },
      },
    });

    const [candidate] = tvlGrowthDetector(triggeringEvent, context);

    expect(candidate?.signalType).toBe(TVL_GROWTH);
    expect(candidate?.reasoning).toMatch(/\$7,000,000 to \$10,000,000/);
    expect(candidate?.reasoning).toMatch(/\+42\.9%/);
  });

  it("does not fire when absolute TVL stays below the floor, even with extreme percent growth", () => {
    const triggeringEvent = event({
      type: "ProtocolSnapshotUpdated",
      metadata: {
        ...(event().metadata as Record<string, unknown>),
        tvl: 100_000,
        changedFrom: { tvl: 10_000 },
      },
    });

    expect(tvlGrowthDetector(triggeringEvent, context)).toHaveLength(0);
  });

  it("does not fire when TVL is large but growth is below the percent floor", () => {
    const triggeringEvent = event({
      type: "ProtocolSnapshotUpdated",
      metadata: {
        ...(event().metadata as Record<string, unknown>),
        tvl: 10_100_000,
        changedFrom: { tvl: 10_000_000 },
      },
    });

    expect(tvlGrowthDetector(triggeringEvent, context)).toHaveLength(0);
  });

  it("does not fire on ProtocolSnapshotRecorded (no previous TVL to compare against)", () => {
    expect(tvlGrowthDetector(event(), context)).toHaveLength(0);
  });
});

describe("auditCoverageGapDetector", () => {
  it("fires with the exact required phrasing when audits is '0' above the TVL floor", () => {
    const triggeringEvent = event({
      metadata: { ...(event().metadata as Record<string, unknown>), audits: "0", tvl: 5_000_000 },
    });

    const [candidate] = auditCoverageGapDetector(triggeringEvent, context);

    expect(candidate?.signalType).toBe(AUDIT_COVERAGE_GAP);
    expect(candidate?.reasoning).toMatch(
      /^Limited audit coverage indicated by available DefiLlama metadata\./,
    );
    expect(candidate?.reasoning).toMatch(/does not confirm the protocol is unaudited/);
  });

  it("preserves audit links for future investigation when present", () => {
    const triggeringEvent = event({
      metadata: {
        ...(event().metadata as Record<string, unknown>),
        audits: "0",
        tvl: 5_000_000,
        auditLinks: ["https://example.com/audit-pending"],
      },
    });

    const [candidate] = auditCoverageGapDetector(triggeringEvent, context);

    expect(candidate?.reasoning).toMatch(/https:\/\/example\.com\/audit-pending/);
  });

  it("does not fire when audits is greater than '0'", () => {
    const triggeringEvent = event({
      metadata: { ...(event().metadata as Record<string, unknown>), audits: "1", tvl: 5_000_000 },
    });

    expect(auditCoverageGapDetector(triggeringEvent, context)).toHaveLength(0);
  });

  it("does not fire below the TVL floor, even with audits '0'", () => {
    const triggeringEvent = event({
      metadata: { ...(event().metadata as Record<string, unknown>), audits: "0", tvl: 10_000 },
    });

    expect(auditCoverageGapDetector(triggeringEvent, context)).toHaveLength(0);
  });

  it("does not fire for a CEX, even with audits '0' and high TVL", () => {
    const triggeringEvent = event({
      metadata: {
        ...(event().metadata as Record<string, unknown>),
        category: "CEX",
        audits: "0",
        tvl: 10_000_000_000,
      },
    });

    expect(auditCoverageGapDetector(triggeringEvent, context)).toHaveLength(0);
  });

  it("does not fire for a Risk Curator, even with audits '0' and high TVL", () => {
    const triggeringEvent = event({
      metadata: {
        ...(event().metadata as Record<string, unknown>),
        category: "Risk Curators",
        audits: "0",
        tvl: 2_500_000_000,
      },
    });

    expect(auditCoverageGapDetector(triggeringEvent, context)).toHaveLength(0);
  });

  it("still fires for an on-chain bridge — bridge categories are not blanket-excluded", () => {
    const triggeringEvent = event({
      metadata: {
        ...(event().metadata as Record<string, unknown>),
        category: "Canonical Bridge",
        audits: "0",
        tvl: 3_000_000_000,
      },
    });

    expect(auditCoverageGapDetector(triggeringEvent, context)).toHaveLength(1);
  });

  it("still fires for eligible smart-contract categories (Dexs, Lending, Liquid Staking)", () => {
    for (const category of ["Dexs", "Lending", "Liquid Staking"]) {
      const triggeringEvent = event({
        metadata: {
          ...(event().metadata as Record<string, unknown>),
          category,
          audits: "0",
          tvl: 5_000_000,
        },
      });
      expect(auditCoverageGapDetector(triggeringEvent, context)).toHaveLength(1);
    }
  });
});
