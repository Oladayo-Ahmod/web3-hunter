import { describe, expect, it } from "vitest";
import { isCategoryEligibleForAuditCoverageGap } from "./audit-coverage-gap-eligibility";

describe("isCategoryEligibleForAuditCoverageGap", () => {
  it("excludes CEX", () => {
    expect(isCategoryEligibleForAuditCoverageGap("CEX")).toBe(false);
  });

  it("excludes Risk Curators", () => {
    expect(isCategoryEligibleForAuditCoverageGap("Risk Curators")).toBe(false);
  });

  it("does not blanket-exclude bridge categories", () => {
    expect(isCategoryEligibleForAuditCoverageGap("Bridge")).toBe(true);
    expect(isCategoryEligibleForAuditCoverageGap("Canonical Bridge")).toBe(true);
    expect(isCategoryEligibleForAuditCoverageGap("Cross Chain Bridge")).toBe(true);
  });

  it("allows eligible smart-contract categories", () => {
    for (const category of ["Dexs", "Lending", "Liquid Staking", "CDP", "Yield"]) {
      expect(isCategoryEligibleForAuditCoverageGap(category)).toBe(true);
    }
  });

  it("allows a null category (nothing to exclude it by)", () => {
    expect(isCategoryEligibleForAuditCoverageGap(null)).toBe(true);
  });
});
