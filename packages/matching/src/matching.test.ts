import { describe, expect, it } from "vitest";
import { computeMatch, matchComputationsEqual } from "./matching";

describe("computeMatch", () => {
  it("returns a zero score with an explanatory reasoning when the Opportunity has no tagged Skills", () => {
    const result = computeMatch(["skill-a"], []);
    expect(result.score).toBe(0);
    expect(result.matchedSkillIds).toEqual([]);
    expect(result.reasoning).toContain("no tagged Skills");
  });

  it("is deterministic: the same inputs always produce the same result", () => {
    const first = computeMatch(["skill-a", "skill-b"], ["skill-a", "skill-c"]);
    const second = computeMatch(["skill-a", "skill-b"], ["skill-a", "skill-c"]);
    expect(second).toEqual(first);
  });

  it("scores as the fraction of the Opportunity's tagged Skills the User has", () => {
    const result = computeMatch(["skill-a"], ["skill-a", "skill-b", "skill-c", "skill-d"]);
    expect(result.score).toBe(0.25);
    expect(result.matchedSkillIds).toEqual(["skill-a"]);
  });

  it("returns a score of 1 when the User has every tagged Skill", () => {
    const result = computeMatch(["skill-a", "skill-b"], ["skill-a", "skill-b"]);
    expect(result.score).toBe(1);
  });

  it("returns a score of 0 and no matched Skills when there is no overlap", () => {
    const result = computeMatch(["skill-x"], ["skill-a", "skill-b"]);
    expect(result.score).toBe(0);
    expect(result.matchedSkillIds).toEqual([]);
    expect(result.reasoning).toContain("No overlap");
  });

  it("ignores the order of either input list", () => {
    const a = computeMatch(["skill-b", "skill-a"], ["skill-c", "skill-a", "skill-b"]);
    const b = computeMatch(["skill-a", "skill-b"], ["skill-a", "skill-b", "skill-c"]);
    expect(a.score).toBe(b.score);
    expect([...a.matchedSkillIds].sort()).toEqual([...b.matchedSkillIds].sort());
  });
});

describe("matchComputationsEqual", () => {
  it("is true for identical computations regardless of matchedSkillIds order", () => {
    const a = { score: 0.5, reasoning: "x", matchedSkillIds: ["a", "b"] };
    const b = { score: 0.5, reasoning: "x", matchedSkillIds: ["b", "a"] };
    expect(matchComputationsEqual(a, b)).toBe(true);
  });

  it("is false when the score differs", () => {
    const a = { score: 0.5, reasoning: "x", matchedSkillIds: ["a"] };
    const b = { score: 0.6, reasoning: "x", matchedSkillIds: ["a"] };
    expect(matchComputationsEqual(a, b)).toBe(false);
  });

  it("is false when the matched Skill set differs", () => {
    const a = { score: 0.5, reasoning: "x", matchedSkillIds: ["a"] };
    const b = { score: 0.5, reasoning: "x", matchedSkillIds: ["b"] };
    expect(matchComputationsEqual(a, b)).toBe(false);
  });
});
