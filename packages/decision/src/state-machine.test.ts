import { describe, expect, it } from "vitest";
import { canTransition, InvalidRecommendationTransitionError, transition } from "./state-machine";

describe("state-machine", () => {
  it.each([
    ["active", "dismiss", "dismissed"],
    ["active", "archive", "archived"],
    ["active", "expire", "expired"],
    ["dismissed", "restore", "active"],
    ["archived", "restore", "active"],
  ] as const)("allows %s --%s--> %s", (from, action, expected) => {
    expect(transition(from, action)).toBe(expected);
    expect(canTransition(from, action)).toBe(true);
  });

  it.each([
    ["dismissed", "dismiss"],
    ["dismissed", "archive"],
    ["dismissed", "expire"],
    ["archived", "dismiss"],
    ["archived", "archive"],
    ["archived", "expire"],
    ["expired", "dismiss"],
    ["expired", "archive"],
    ["expired", "restore"],
    ["expired", "expire"],
    ["active", "restore"],
  ] as const)("rejects %s --%s-->", (from, action) => {
    expect(canTransition(from, action)).toBe(false);
    expect(() => transition(from, action)).toThrow(InvalidRecommendationTransitionError);
  });

  it("expired is terminal: no action transitions out of it", () => {
    for (const action of ["dismiss", "archive", "restore", "expire"] as const) {
      expect(canTransition("expired", action)).toBe(false);
    }
  });
});
