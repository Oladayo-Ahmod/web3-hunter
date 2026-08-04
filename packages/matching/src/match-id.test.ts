import { describe, expect, it } from "vitest";
import { deriveMatchId } from "./match-id";

describe("deriveMatchId", () => {
  it("is deterministic for the same User Profile x Opportunity pair", () => {
    const identity = { userId: "user-1", opportunityId: "opportunity-1" };
    expect(deriveMatchId(identity)).toBe(deriveMatchId({ ...identity }));
  });

  it("differs for a different User with the same Opportunity", () => {
    const a = deriveMatchId({ userId: "user-1", opportunityId: "opportunity-1" });
    const b = deriveMatchId({ userId: "user-2", opportunityId: "opportunity-1" });
    expect(a).not.toBe(b);
  });

  it("differs for a different Opportunity with the same User", () => {
    const a = deriveMatchId({ userId: "user-1", opportunityId: "opportunity-1" });
    const b = deriveMatchId({ userId: "user-1", opportunityId: "opportunity-2" });
    expect(a).not.toBe(b);
  });
});
