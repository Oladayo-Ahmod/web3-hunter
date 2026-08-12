import { describe, expect, it } from "vitest";
import { computeJobRelevance, inferSeniorityFromTitle, tierForScore } from "./job-relevance";

const SOLIDITY = "skill-solidity";
const SECURITY = "skill-security";
const FOUNDRY = "skill-foundry";
const RUST = "skill-rust";

const skillNames = new Map([
  [SOLIDITY, "Solidity"],
  [SECURITY, "Smart Contract Security"],
  [FOUNDRY, "Foundry"],
  [RUST, "Rust"],
]);

function profile(overrides: Partial<Parameters<typeof computeJobRelevance>[2]> = {}) {
  return {
    skillIds: [] as string[],
    targetRoleSlugs: [] as string[],
    remotePreference: null,
    seniorityPreference: [] as string[],
    ...overrides,
  };
}

function job(overrides: Partial<Parameters<typeof computeJobRelevance>[0]> = {}) {
  return {
    title: "Smart Contract Security Engineer",
    departmentNames: [],
    workplaceType: null,
    ...overrides,
  };
}

describe("computeJobRelevance", () => {
  it("scores 0 with no skill overlap and no profile signal", () => {
    const result = computeJobRelevance(
      job({ title: "Product Marketing Manager" }),
      [SOLIDITY],
      profile({ skillIds: [RUST] }),
      skillNames,
    );
    expect(result.score).toBe(0);
    expect(result.tier).toBe("low");
  });

  it("rewards matched skills proportionally, with a breakdown entry per matched skill", () => {
    const result = computeJobRelevance(
      job(),
      [SOLIDITY, SECURITY, FOUNDRY, RUST],
      profile({ skillIds: [SOLIDITY, SECURITY] }),
      skillNames,
    );
    // 2/4 matched -> 35 of the 70 skill-fit points, split across 2 skills
    expect(result.score).toBe(35);
    expect(result.breakdown).toEqual(
      expect.arrayContaining([
        { label: "Solidity", weight: 17.5 },
        { label: "Smart Contract Security", weight: 17.5 },
      ]),
    );
  });

  it("does not penalize a Job with zero detected Skills as if it were a mismatch — it's just absent", () => {
    const result = computeJobRelevance(job(), [], profile({ skillIds: [SOLIDITY] }), skillNames);
    expect(result.score).toBe(0);
    expect(result.breakdown).toEqual([]);
  });

  it("adds a target-role bonus only when the title matches a configured role", () => {
    const matched = computeJobRelevance(
      job({ title: "Smart Contract Security Engineer" }),
      [],
      profile({ targetRoleSlugs: ["smart-contract-security-engineer"] }),
      skillNames,
    );
    expect(matched.score).toBe(20);

    const unmatched = computeJobRelevance(
      job({ title: "Product Marketing Manager" }),
      [],
      profile({ targetRoleSlugs: ["smart-contract-security-engineer"] }),
      skillNames,
    );
    // No bonus, and also no explicit penalty just for not matching a role.
    expect(unmatched.score).toBe(0);
  });

  it("excludes the role component entirely when the User has no target roles configured", () => {
    const result = computeJobRelevance(job(), [], profile({ targetRoleSlugs: [] }), skillNames);
    expect(result.breakdown.some((entry) => entry.label.startsWith("Target role"))).toBe(false);
  });

  it("treats an unknown workplaceType as excluded, never as a remote mismatch", () => {
    const result = computeJobRelevance(
      job({ workplaceType: null }),
      [],
      profile({ remotePreference: "remote_only" }),
      skillNames,
    );
    expect(result.breakdown.some((entry) => entry.label.includes("Remote"))).toBe(false);
    expect(result.breakdown.some((entry) => entry.label.includes("Workplace"))).toBe(false);
  });

  it("rewards a satisfied remote_only preference and penalizes a clear mismatch", () => {
    const satisfied = computeJobRelevance(
      job({ workplaceType: "remote" }),
      [],
      profile({ remotePreference: "remote_only" }),
      skillNames,
    );
    expect(satisfied.score).toBe(10);

    const mismatched = computeJobRelevance(
      job({ workplaceType: "onsite" }),
      [],
      profile({ remotePreference: "remote_only" }),
      skillNames,
    );
    expect(mismatched.score).toBe(0); // clamped at 0, not negative
  });

  it("treats remote_friendly as satisfied by hybrid, not just fully remote", () => {
    const result = computeJobRelevance(
      job({ workplaceType: "hybrid" }),
      [],
      profile({ remotePreference: "remote_friendly" }),
      skillNames,
    );
    expect(result.score).toBe(10);
  });

  it("excludes seniority scoring when the title states no level, even with a preference set", () => {
    const result = computeJobRelevance(
      job({ title: "Solidity Engineer" }),
      [],
      profile({ seniorityPreference: ["junior"] }),
      skillNames,
    );
    expect(result.breakdown.some((entry) => entry.label.includes("Seniority"))).toBe(false);
  });

  it("penalizes a clear seniority mismatch", () => {
    const result = computeJobRelevance(
      job({ title: "Senior Solidity Engineer" }),
      [SOLIDITY],
      profile({ skillIds: [SOLIDITY], seniorityPreference: ["junior"] }),
      skillNames,
    );
    // 70 (full skill fit, 1/1 matched) - 10 seniority mismatch = 60
    expect(result.score).toBe(60);
    expect(result.breakdown).toContainEqual({
      label: "Seniority mismatch (this posting reads as senior)",
      weight: -10,
    });
  });

  it("heavily penalizes titles carrying a negative (unrelated-role) keyword", () => {
    const result = computeJobRelevance(
      job({ title: "AML Compliance Director" }),
      [SOLIDITY],
      profile({ skillIds: [SOLIDITY] }),
      skillNames,
    );
    // Even with an (implausible) skill match, the negative signal drags it down hard.
    expect(result.score).toBeLessThan(40);
  });

  it("ranks a clearly relevant engineering title above an unrelated one at the same company, matching the products intended UX", () => {
    const relevant = computeJobRelevance(
      job({ title: "Smart Contract Security Engineer", workplaceType: "remote" }),
      [SOLIDITY, SECURITY],
      profile({
        skillIds: [SOLIDITY, SECURITY, FOUNDRY],
        targetRoleSlugs: ["smart-contract-security-engineer"],
        remotePreference: "remote_only",
      }),
      skillNames,
    );
    const unrelated = computeJobRelevance(
      job({ title: "Product Marketing Manager", workplaceType: "remote" }),
      [],
      profile({
        skillIds: [SOLIDITY, SECURITY, FOUNDRY],
        targetRoleSlugs: ["smart-contract-security-engineer"],
        remotePreference: "remote_only",
      }),
      skillNames,
    );
    expect(relevant.score).toBeGreaterThan(unrelated.score);
    expect(relevant.tier).toBe("high");
    expect(unrelated.tier).toBe("low");
  });
});

describe("inferSeniorityFromTitle", () => {
  it("recognizes common senior signals", () => {
    expect(inferSeniorityFromTitle("Senior Solidity Engineer")).toBe("senior");
    expect(inferSeniorityFromTitle("Staff Security Engineer")).toBe("senior");
    expect(inferSeniorityFromTitle("Principal Protocol Engineer")).toBe("senior");
  });

  it("recognizes common junior signals", () => {
    expect(inferSeniorityFromTitle("Junior Solidity Engineer")).toBe("junior");
    expect(inferSeniorityFromTitle("Security Engineering Intern")).toBe("junior");
  });

  it("returns null (unspecified), not a guess, when the title states no level", () => {
    expect(inferSeniorityFromTitle("Solidity Engineer")).toBeNull();
    expect(inferSeniorityFromTitle("Protocol Engineer")).toBeNull();
  });
});

describe("tierForScore", () => {
  it("buckets at the documented thresholds", () => {
    expect(tierForScore(70)).toBe("high");
    expect(tierForScore(69)).toBe("medium");
    expect(tierForScore(40)).toBe("medium");
    expect(tierForScore(39)).toBe("low");
    expect(tierForScore(0)).toBe("low");
  });
});
