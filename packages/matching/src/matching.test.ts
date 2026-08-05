import { describe, expect, it } from "vitest";
import { SKILL_FIT_WEIGHT, TECHNOLOGY_FIT_WEIGHT } from "./constants";
import { computeMatch, matchComputationsEqual } from "./matching";

describe("computeMatch", () => {
  it("returns a zero score with an explanatory reasoning when the Opportunity has no tagged Skills", () => {
    const result = computeMatch(["skill-a"], []);
    expect(result.score).toBe(0);
    expect(result.matchedSkillIds).toEqual([]);
    expect(result.matchedTechnologySkillIds).toEqual([]);
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

  describe("technology fit (Milestone 9)", () => {
    it("degrades gracefully to Skill fit alone when the Company has no Technology Profile", () => {
      const withoutTechnology = computeMatch(["skill-a"], ["skill-a", "skill-b"]);
      const withEmptyTechnologyList = computeMatch(["skill-a"], ["skill-a", "skill-b"], []);
      expect(withoutTechnology).toEqual(withEmptyTechnologyList);
      expect(withoutTechnology.score).toBe(0.5);
      expect(withoutTechnology.reasoning).not.toContain("GitHub");
    });

    it("blends Skill fit and Technology fit by their named weights when evidence exists", () => {
      const result = computeMatch(
        ["skill-a", "skill-rust"],
        ["skill-a", "skill-b"],
        ["skill-rust", "skill-go"],
      );

      const expectedSkillFit = 0.5; // 1 of 2 tagged Skills
      const expectedTechnologyFit = 0.5; // 1 of 2 evidenced technologies
      const expectedScore =
        Math.round(
          (expectedSkillFit * SKILL_FIT_WEIGHT + expectedTechnologyFit * TECHNOLOGY_FIT_WEIGHT) *
            100,
        ) / 100;

      expect(result.score).toBe(expectedScore);
      expect(result.matchedSkillIds).toEqual(["skill-a"]);
      expect(result.matchedTechnologySkillIds).toEqual(["skill-rust"]);
      expect(result.reasoning).toContain("GitHub");
    });

    it("reports zero technology overlap explicitly, distinct from absent evidence", () => {
      const result = computeMatch(["skill-a"], ["skill-a"], ["skill-rust"]);
      expect(result.matchedTechnologySkillIds).toEqual([]);
      expect(result.reasoning).toContain("No overlap with this Company's 1 GitHub-evidenced");
    });

    it("still yields the maximum score of 1 when both Skill and Technology fit are perfect", () => {
      const result = computeMatch(["skill-a", "skill-rust"], ["skill-a"], ["skill-rust"]);
      expect(result.score).toBe(1);
    });
  });
});

describe("matchComputationsEqual", () => {
  it("is true for identical computations regardless of matchedSkillIds order", () => {
    const a = {
      score: 0.5,
      reasoning: "x",
      matchedSkillIds: ["a", "b"],
      matchedTechnologySkillIds: [],
    };
    const b = {
      score: 0.5,
      reasoning: "x",
      matchedSkillIds: ["b", "a"],
      matchedTechnologySkillIds: [],
    };
    expect(matchComputationsEqual(a, b)).toBe(true);
  });

  it("is false when the score differs", () => {
    const a = { score: 0.5, reasoning: "x", matchedSkillIds: ["a"], matchedTechnologySkillIds: [] };
    const b = { score: 0.6, reasoning: "x", matchedSkillIds: ["a"], matchedTechnologySkillIds: [] };
    expect(matchComputationsEqual(a, b)).toBe(false);
  });

  it("is false when the matched Skill set differs", () => {
    const a = { score: 0.5, reasoning: "x", matchedSkillIds: ["a"], matchedTechnologySkillIds: [] };
    const b = { score: 0.5, reasoning: "x", matchedSkillIds: ["b"], matchedTechnologySkillIds: [] };
    expect(matchComputationsEqual(a, b)).toBe(false);
  });

  it("is false when the matched Technology Skill set differs", () => {
    const a = {
      score: 0.5,
      reasoning: "x",
      matchedSkillIds: ["a"],
      matchedTechnologySkillIds: ["t1"],
    };
    const b = {
      score: 0.5,
      reasoning: "x",
      matchedSkillIds: ["a"],
      matchedTechnologySkillIds: ["t2"],
    };
    expect(matchComputationsEqual(a, b)).toBe(false);
  });
});
