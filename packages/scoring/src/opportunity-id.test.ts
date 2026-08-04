import { describe, expect, it } from "vitest";
import { deriveOpportunityId } from "./opportunity-id";

describe("deriveOpportunityId", () => {
  const base = {
    companyId: "company-a",
    opportunityType: "engineering-hiring-surge",
    detectionWindow: "2026-W02",
  };

  it("is deterministic: the same inputs always produce the same ID", () => {
    expect(deriveOpportunityId(base)).toBe(deriveOpportunityId({ ...base }));
  });

  it("changes when the company changes", () => {
    expect(deriveOpportunityId({ ...base, companyId: "company-b" })).not.toBe(
      deriveOpportunityId(base),
    );
  });

  it("changes when the opportunity type changes", () => {
    expect(deriveOpportunityId({ ...base, opportunityType: "other-type" })).not.toBe(
      deriveOpportunityId(base),
    );
  });

  it("changes when the detection window changes", () => {
    expect(deriveOpportunityId({ ...base, detectionWindow: "2026-W03" })).not.toBe(
      deriveOpportunityId(base),
    );
  });

  it("produces a well-formed UUID", () => {
    expect(deriveOpportunityId(base)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });
});
