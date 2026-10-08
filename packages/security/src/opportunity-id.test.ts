import { describe, expect, it } from "vitest";
import {
  ACTIVE_PROTOCOL,
  AUDIT_CONTEST,
  BUG_BOUNTY,
  DISCLOSURE,
  SECURITY_RESEARCH,
  SHADOW_AUDIT,
  deriveSecurityOpportunityId,
} from "./opportunity-id";

describe("deriveSecurityOpportunityId", () => {
  const base = {
    securityTargetId: "target-a",
    opportunityType: AUDIT_CONTEST,
    detectionWindow: "2026-W02",
  };

  it("is deterministic: the same inputs always produce the same ID", () => {
    expect(deriveSecurityOpportunityId(base)).toBe(deriveSecurityOpportunityId({ ...base }));
  });

  it("changes when the security target changes", () => {
    expect(deriveSecurityOpportunityId({ ...base, securityTargetId: "target-b" })).not.toBe(
      deriveSecurityOpportunityId(base),
    );
  });

  it("changes when the opportunity type changes", () => {
    expect(deriveSecurityOpportunityId({ ...base, opportunityType: BUG_BOUNTY })).not.toBe(
      deriveSecurityOpportunityId(base),
    );
  });

  it("changes when the detection window changes", () => {
    expect(deriveSecurityOpportunityId({ ...base, detectionWindow: "2026-W03" })).not.toBe(
      deriveSecurityOpportunityId(base),
    );
  });

  it("produces a well-formed UUID", () => {
    expect(deriveSecurityOpportunityId(base)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });
});

describe("Security Opportunity Type vocabulary", () => {
  it("defines six distinct, non-empty type names", () => {
    const types = [
      AUDIT_CONTEST,
      BUG_BOUNTY,
      ACTIVE_PROTOCOL,
      SHADOW_AUDIT,
      SECURITY_RESEARCH,
      DISCLOSURE,
    ];
    expect(new Set(types).size).toBe(types.length);
    for (const type of types) {
      expect(type.length).toBeGreaterThan(0);
    }
  });
});
