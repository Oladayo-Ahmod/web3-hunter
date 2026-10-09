import { describe, expect, it } from "vitest";
import { registerSecuritySignalType } from "./registry";
import { meetsSecurityOpportunityThreshold } from "./security-opportunity-detection";

registerSecuritySignalType("__test__qualifying-type", { qualifiesForOpportunity: true });
registerSecuritySignalType("__test__non-qualifying-type", { qualifiesForOpportunity: false });

describe("meetsSecurityOpportunityThreshold", () => {
  it("returns false for an empty signal list", () => {
    expect(meetsSecurityOpportunityThreshold([])).toBe(false);
  });

  it("returns false when every present signal type is non-qualifying (e.g. NEW_PROTOCOL alone)", () => {
    expect(meetsSecurityOpportunityThreshold(["__test__non-qualifying-type"])).toBe(false);
  });

  it("returns true when at least one present signal type qualifies on its own", () => {
    expect(meetsSecurityOpportunityThreshold(["__test__qualifying-type"])).toBe(true);
  });

  it("returns true for a mix of qualifying and non-qualifying types, deterministically", () => {
    const mixed = ["__test__non-qualifying-type", "__test__qualifying-type"];
    expect(meetsSecurityOpportunityThreshold(mixed)).toBe(true);
    // Order independence: the same set in a different order yields the same result.
    expect(meetsSecurityOpportunityThreshold([...mixed].reverse())).toBe(true);
  });

  it("returns false for an unregistered signal type name", () => {
    expect(meetsSecurityOpportunityThreshold(["__test__never-registered"])).toBe(false);
  });
});
