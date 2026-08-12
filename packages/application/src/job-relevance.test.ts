import { describe, expect, it } from "vitest";
import {
  computeJobRelevance,
  inferSeniorityFromTitle,
  parseLocationScope,
  tierForScore,
  type JobRelevanceJobInput,
  type JobRelevanceProfile,
} from "./job-relevance";

const SOLIDITY = "skill-solidity";
const SECURITY = "skill-security";
const FOUNDRY = "skill-foundry";
const RUST = "skill-rust";
const FRONTEND_SKILL = "skill-frontend-engineering";
const TYPESCRIPT = "skill-typescript";

const skillNames = new Map([
  [SOLIDITY, "Solidity"],
  [SECURITY, "Smart Contract Security"],
  [FOUNDRY, "Foundry"],
  [RUST, "Rust"],
  [FRONTEND_SKILL, "Frontend Engineering"],
  [TYPESCRIPT, "TypeScript"],
]);

/** The 8 target roles this product is actually built around — used throughout as the "real" profile shape, not an arbitrary test fixture. */
const ALL_TARGET_ROLE_SLUGS = [
  "smart-contract-security-engineer",
  "blockchain-security-engineer",
  "smart-contract-auditor",
  "solidity-engineer",
  "protocol-engineer",
  "security-researcher",
  "blockchain-engineer",
  "web3-backend-engineer",
];

function profile(overrides: Partial<JobRelevanceProfile> = {}): JobRelevanceProfile {
  return {
    skillIds: [],
    targetRoleSlugs: [],
    remotePreference: null,
    seniorityPreference: [],
    locationConstraint: null,
    ...overrides,
  };
}

function job(overrides: Partial<JobRelevanceJobInput> = {}): JobRelevanceJobInput {
  return {
    title: "Smart Contract Security Engineer",
    departmentNames: [],
    workplaceType: null,
    locationName: null,
    ...overrides,
  };
}

describe("role compatibility (Milestone 13 Phase A — the dominant signal)", () => {
  it("rewards a direct target-role match with the dominant positive weight", () => {
    const result = computeJobRelevance(
      job({ title: "Solidity Engineer" }),
      [],
      profile({ targetRoleSlugs: ["solidity-engineer"] }),
      skillNames,
    );
    expect(result.score).toBe(45);
    expect(result.breakdown).toContainEqual({
      label: "Target role: Solidity Engineer",
      weight: 45,
    });
  });

  it("penalizes a title matching a known-incompatible role family with the dominant negative weight", () => {
    const result = computeJobRelevance(
      job({ title: "Senior Frontend Engineer" }),
      [],
      profile({ targetRoleSlugs: ["solidity-engineer"] }),
      skillNames,
    );
    expect(result.breakdown).toContainEqual(
      expect.objectContaining({
        weight: -35,
        label: expect.stringContaining("Frontend Engineering"),
      }),
    );
  });

  it("excludes the role component entirely when the title matches neither a target role nor a known-incompatible family", () => {
    const result = computeJobRelevance(
      job({ title: "Software Engineer" }),
      [],
      profile({ targetRoleSlugs: ["solidity-engineer"] }),
      skillNames,
    );
    expect(result.breakdown.some((entry) => entry.label.startsWith("Target role"))).toBe(false);
    expect(result.breakdown.some((entry) => entry.label.startsWith("Role mismatch"))).toBe(false);
  });

  it("excludes the role component entirely when the User has no target roles configured", () => {
    const result = computeJobRelevance(
      job({ title: "Senior Frontend Engineer" }),
      [],
      profile({ targetRoleSlugs: [] }),
      skillNames,
    );
    expect(result.breakdown.some((entry) => entry.label.startsWith("Role mismatch"))).toBe(false);
  });
});

describe("skill fit (rescaled to a 30-point ceiling)", () => {
  it("rewards matched skills proportionally, capped at 30 total", () => {
    const result = computeJobRelevance(
      job({ title: "Generic Engineer" }),
      [SOLIDITY, SECURITY, FOUNDRY, RUST],
      profile({ skillIds: [SOLIDITY, SECURITY] }),
      skillNames,
    );
    // 2/4 matched -> 15 of the 30 skill-fit points, split across 2 skills
    expect(result.score).toBe(15);
    expect(result.breakdown).toEqual(
      expect.arrayContaining([
        { label: "Solidity", weight: 7.5 },
        { label: "Smart Contract Security", weight: 7.5 },
      ]),
    );
  });

  it("cannot alone manufacture a high match — a single incidental skill overlap tops out at 30, below the 70-point high threshold", () => {
    const result = computeJobRelevance(
      job({ title: "Generic Engineer" }),
      [FRONTEND_SKILL],
      profile({ skillIds: [FRONTEND_SKILL] }),
      skillNames,
    );
    expect(result.score).toBe(30);
    expect(result.tier).not.toBe("high");
  });

  it("does not penalize a Job with zero detected Skills as if it were a mismatch — it's just absent", () => {
    const result = computeJobRelevance(job(), [], profile({ skillIds: [SOLIDITY] }), skillNames);
    expect(result.score).toBe(0);
    expect(result.breakdown).toEqual([]);
  });
});

describe("seniority matrix", () => {
  it("recognizes manager/director as a distinct, previously-unclassified level", () => {
    expect(inferSeniorityFromTitle("Director of Engineering")).toBe("manager");
    expect(inferSeniorityFromTitle("Engineering Manager")).toBe("manager");
    expect(inferSeniorityFromTitle("VP of Engineering")).toBe("manager");
  });

  it("distinguishes staff/principal from senior", () => {
    expect(inferSeniorityFromTitle("Staff Engineer")).toBe("staff");
    expect(inferSeniorityFromTitle("Principal Engineer")).toBe("staff");
    expect(inferSeniorityFromTitle("Senior Engineer")).toBe("senior");
  });

  it("resolves the most consequential signal when multiple appear (manager > staff > senior)", () => {
    expect(inferSeniorityFromTitle("Senior Staff Engineer")).toBe("staff");
    expect(inferSeniorityFromTitle("Senior Engineering Manager")).toBe("manager");
  });

  it("returns null when the title states no level", () => {
    expect(inferSeniorityFromTitle("Solidity Engineer")).toBeNull();
  });

  it("rewards a junior-preference User for a junior posting", () => {
    const result = computeJobRelevance(
      job({ title: "Junior Solidity Engineer" }),
      [],
      profile({ seniorityPreference: ["junior"] }),
      skillNames,
    );
    expect(result.breakdown).toContainEqual(expect.objectContaining({ weight: 8 }));
  });

  it("penalizes a manager-level posting for a junior-preference User more than a senior one", () => {
    // Both clamp to a displayed 0% (the raw penalty exceeds what there is
    // to subtract from) - the real distinction is in the seniority
    // breakdown entry's own weight, not the overall clamped score.
    const juniorPref = profile({ seniorityPreference: ["junior"] });
    const manager = computeJobRelevance(
      job({ title: "Engineering Manager" }),
      [],
      juniorPref,
      skillNames,
    );
    const senior = computeJobRelevance(
      job({ title: "Senior Engineer" }),
      [],
      juniorPref,
      skillNames,
    );
    const seniorityWeight = (result: ReturnType<typeof computeJobRelevance>) =>
      result.breakdown.find((entry) => entry.label.includes("Seniority"))?.weight ?? 0;
    expect(seniorityWeight(manager)).toBeLessThan(seniorityWeight(senior));
  });

  it("takes the most favorable applicable cell across multiple selected preferences", () => {
    // junior+mid selected (this product's real, current default profile
    // shape) - a "Senior Engineer" posting should use mid's -5, not
    // junior's -10, since mid is the better-fitting preference here.
    const result = computeJobRelevance(
      job({ title: "Senior Engineer" }),
      [],
      profile({ seniorityPreference: ["junior", "mid"] }),
      skillNames,
    );
    expect(result.breakdown).toContainEqual(expect.objectContaining({ weight: -5 }));
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
});

describe("location model", () => {
  it("parses free text into the closed vocabulary", () => {
    expect(parseLocationScope(null)).toEqual({ kind: "unspecified" });
    expect(parseLocationScope("")).toEqual({ kind: "unspecified" });
    expect(parseLocationScope("Worldwide")).toEqual({ kind: "worldwide" });
    expect(parseLocationScope("EMEA")).toEqual({ kind: "region", region: "emea" });
    expect(parseLocationScope("USA")).toEqual({ kind: "country", country: "usa" });
    expect(parseLocationScope("Narnia")).toEqual({ kind: "unspecified" });
  });

  it("excludes the location component when unspecified (today's real, common state)", () => {
    const result = computeJobRelevance(
      job({ locationName: "Remote - USA" }),
      [],
      profile({ locationConstraint: null }),
      skillNames,
    );
    expect(result.breakdown.some((entry) => entry.label.includes("Location"))).toBe(false);
  });

  it("excludes the location component when the Job has no captured location text", () => {
    const result = computeJobRelevance(
      job({ locationName: null }),
      [],
      profile({ locationConstraint: "USA" }),
      skillNames,
    );
    expect(result.breakdown.some((entry) => entry.label.includes("Location"))).toBe(false);
  });

  it("rewards a matching region/country constraint", () => {
    const result = computeJobRelevance(
      job({ locationName: "Remote - USA" }),
      [],
      profile({ locationConstraint: "USA" }),
      skillNames,
    );
    expect(result.breakdown).toContainEqual(expect.objectContaining({ weight: 10 }));
  });

  it("penalizes a non-matching region/country constraint", () => {
    const result = computeJobRelevance(
      job({ locationName: "EMEA only" }),
      [],
      profile({ locationConstraint: "USA" }),
      skillNames,
    );
    expect(result.breakdown).toContainEqual(expect.objectContaining({ weight: -10 }));
  });
});

describe("remote/workplace preference (unchanged mechanics)", () => {
  it("treats an unknown workplaceType as excluded, never as a remote mismatch", () => {
    const result = computeJobRelevance(
      job({ workplaceType: null }),
      [],
      profile({ remotePreference: "remote_only" }),
      skillNames,
    );
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
});

describe("negative keyword penalty (unchanged)", () => {
  it("heavily penalizes titles carrying a negative (unrelated-role) keyword", () => {
    const result = computeJobRelevance(
      job({ title: "AML Compliance Director" }),
      [SOLIDITY],
      profile({ skillIds: [SOLIDITY] }),
      skillNames,
    );
    expect(result.score).toBeLessThan(40);
  });
});

describe("tierForScore — buckets the raw, unclamped score", () => {
  it("buckets at the documented thresholds", () => {
    expect(tierForScore(70)).toBe("high");
    expect(tierForScore(69)).toBe("medium");
    expect(tierForScore(40)).toBe("medium");
    expect(tierForScore(39)).toBe("low");
    expect(tierForScore(-19)).toBe("low");
    expect(tierForScore(-20)).toBe("low");
    expect(tierForScore(-21)).toBe("very-low");
  });

  it("distinguishes a plain unmatched job from one with stacked negative evidence, even though both clamp to a 0% displayed score", () => {
    const plain = computeJobRelevance(
      job({ title: "Software Engineer" }),
      [],
      profile(),
      skillNames,
    );
    const stacked = computeJobRelevance(
      job({ title: "Marketing Manager" }),
      [],
      profile({ targetRoleSlugs: ["solidity-engineer"] }),
      skillNames,
    );
    expect(plain.score).toBe(0);
    expect(stacked.score).toBe(0);
    expect(plain.tier).not.toBe(stacked.tier);
  });
});

describe("regression: the real production false positive that triggered Milestone 13 Phase A", () => {
  it('does not let "Senior Software Engineer, Frontend" reach a high match for a security/protocol-targeting profile just because Frontend Engineering is in the Skill list', () => {
    // The exact real scenario: job_skill classified this posting with
    // exactly one Skill, Frontend Engineering, which the real User's
    // profile also has - the literal mechanism traced in
    // docs/MILESTONE_13_DISCOVERY_AND_RELEVANCE_REVIEW.md §1/§6.
    const result = computeJobRelevance(
      job({ title: "Senior Software Engineer, Frontend (Coinbase Advisor - Agentic Trading)" }),
      [FRONTEND_SKILL],
      profile({
        skillIds: [SOLIDITY, SECURITY, FOUNDRY, FRONTEND_SKILL, TYPESCRIPT],
        targetRoleSlugs: ALL_TARGET_ROLE_SLUGS,
        seniorityPreference: ["junior", "mid"],
      }),
      skillNames,
    );
    expect(result.tier).not.toBe("high");
    expect(result.score).toBeLessThan(70);
  });
});

describe("explicit ordering — the profile this product is actually built for", () => {
  // Deliberately includes Frontend Engineering, matching the real User's
  // actual saved profile (docs/MILESTONE_13_DISCOVERY_AND_RELEVANCE_REVIEW.md
  // §1) - the whole point of this suite is proving the role gate demotes
  // a frontend job even when a broad, T-shaped Skill list *does* overlap.
  const REAL_PROFILE = profile({
    skillIds: [SOLIDITY, SECURITY, FOUNDRY, RUST, FRONTEND_SKILL],
    targetRoleSlugs: ALL_TARGET_ROLE_SLUGS,
    seniorityPreference: ["junior", "mid"],
  });

  function scoreFor(title: string, jobSkillIds: readonly string[] = []) {
    return computeJobRelevance(job({ title }), jobSkillIds, REAL_PROFILE, skillNames);
  }

  it("ranks every target role above every named non-target role", () => {
    const targetRoleResults = [
      scoreFor("Smart Contract Security Engineer", [SOLIDITY, SECURITY]),
      scoreFor("Blockchain Security Engineer", [SECURITY]),
      scoreFor("Smart Contract Auditor", [SOLIDITY, SECURITY]),
      scoreFor("Solidity Engineer", [SOLIDITY]),
      scoreFor("Protocol Engineer"),
      scoreFor("Security Researcher", [SECURITY]),
      scoreFor("Blockchain Engineer"),
      scoreFor("Web3 Backend Engineer"),
    ];

    const nonTargetResults = {
      frontend: scoreFor("Senior Frontend Engineer", [FRONTEND_SKILL]),
      marketing: scoreFor("Marketing Manager"),
      businessDevelopment: scoreFor("Business Development Associate"),
      engineeringManager: scoreFor("Engineering Manager"),
      seniorStaffFrontend: scoreFor("Senior Staff Frontend Engineer", [FRONTEND_SKILL]),
    };

    const maxNonTarget = Math.max(...Object.values(nonTargetResults).map((r) => r.score));
    for (const targetResult of targetRoleResults) {
      expect(targetResult.score).toBeGreaterThan(maxNonTarget);
    }

    // Every target role reaches at least medium.
    for (const targetResult of targetRoleResults) {
      expect(["high", "medium"]).toContain(targetResult.tier);
    }

    // The exact tiers Milestone 13 Phase A asked for, by name.
    expect(nonTargetResults.frontend.tier).toBe("low");
    expect(nonTargetResults.seniorStaffFrontend.tier).toBe("low");
    expect(nonTargetResults.marketing.tier).toBe("very-low");
    expect(nonTargetResults.businessDevelopment.tier).toBe("very-low");
    expect(["low", "very-low"]).toContain(nonTargetResults.engineeringManager.tier);
  });
});
