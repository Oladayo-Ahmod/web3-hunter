/**
 * Deterministic Job-level relevance scoring (Milestone 13 Phase 2) — the
 * counterpart to `packages/matching`'s `computeMatch`, but for an
 * individual Job instead of a Company-level Opportunity. Same discipline:
 * pure, synchronous, no I/O, same inputs always produce the same output.
 *
 * Every component below that depends on optional User Profile data (role,
 * remote, seniority) is *excluded entirely* from scoring when that data
 * is missing on either side — not scored as a mismatch, not scored as a
 * neutral 0.5. This is deliberate: Phase 1 already found that several ATS
 * sources simply don't report `workplaceType`, and most job titles don't
 * state a seniority level at all — "we don't know" must never look like
 * "this doesn't match," or the score would silently penalize jobs for
 * data gaps that have nothing to do with their actual relevance.
 *
 * The one component that is NOT excluded when a Job has zero detected
 * Skills is skill fit itself — that mirrors `computeMatch`'s own existing
 * behavior for an Opportunity with no tagged Skills (0, with a specific
 * reason, not "unknown").
 *
 * This function never filters — it only scores. Whether/how a caller uses
 * the score to sort or filter a feed is entirely `job-query-service.ts`'s
 * decision, not this module's.
 */

export const JOB_RELEVANCE_TIERS = ["high", "medium", "low"] as const;
export type JobRelevanceTier = (typeof JOB_RELEVANCE_TIERS)[number];

export interface JobRelevanceBreakdownEntry {
  label: string;
  /** Signed points, on the same 0-100 scale as the final `score`. */
  weight: number;
}

export interface JobRelevanceResult {
  score: number;
  tier: JobRelevanceTier;
  breakdown: JobRelevanceBreakdownEntry[];
  matchedSkillIds: readonly string[];
}

export interface JobRelevanceProfile {
  skillIds: readonly string[];
  targetRoleSlugs: readonly string[];
  remotePreference: "remote_only" | "remote_friendly" | "no_preference" | null;
  seniorityPreference: readonly string[];
}

export interface JobRelevanceJobInput {
  title: string;
  departmentNames: readonly string[];
  workplaceType: "remote" | "hybrid" | "onsite" | null;
}

/**
 * The selectable target-role vocabulary (Milestone 13's own examples) —
 * shared between the relevance scorer's role-match component and the
 * Profile form's role picker, so there is exactly one list, not two that
 * can drift apart. Title-keyword matching, the same deterministic
 * approach `packages/classification`'s `SKILL_KEYWORDS` already uses for
 * Skills — not NLP, not an AI classifier.
 */
export const TARGET_ROLES: Readonly<
  Record<string, { name: string; titleKeywords: readonly string[] }>
> = {
  "smart-contract-security-engineer": {
    name: "Smart Contract Security Engineer",
    titleKeywords: ["smart contract security", "contract security"],
  },
  "blockchain-security-engineer": {
    name: "Blockchain Security Engineer",
    titleKeywords: ["blockchain security"],
  },
  "smart-contract-auditor": {
    name: "Smart Contract Auditor",
    titleKeywords: ["smart contract auditor", "smart contract audit", "auditor"],
  },
  "solidity-engineer": {
    name: "Solidity Engineer",
    titleKeywords: ["solidity engineer", "solidity developer"],
  },
  "protocol-engineer": {
    name: "Protocol Engineer",
    titleKeywords: ["protocol engineer"],
  },
  "security-researcher": {
    name: "Security Researcher",
    titleKeywords: ["security researcher"],
  },
  "blockchain-engineer": {
    name: "Blockchain Engineer",
    titleKeywords: ["blockchain engineer"],
  },
  "web3-backend-engineer": {
    name: "Web3 Backend Engineer",
    titleKeywords: ["backend engineer", "backend developer"],
  },
};

/**
 * Roles clearly unrelated to Web3 engineering/security work — the
 * negative signal from the original Milestone 13 pivot request's §6,
 * applied here as a flat penalty rather than through the Skill taxonomy
 * (these aren't "absence of a skill," they're active evidence a role is
 * a mismatch).
 */
const NEGATIVE_TITLE_KEYWORDS = [
  "aml",
  "compliance",
  "accounting",
  "legal",
  "marketing",
  "sales",
  "business development",
  "recruiter",
  "customer support",
  "human resources",
  "hr",
];

const SENIOR_TITLE_KEYWORDS = ["senior", "sr.", "staff", "principal", "lead"];
const JUNIOR_TITLE_KEYWORDS = ["junior", "jr.", "entry-level", "entry level", "intern"];

// v1, documented as v1 — a first, defensible weighting, not a calibrated
// model, the same framing `packages/matching`'s `SKILL_FIT_WEIGHT`/
// `TECHNOLOGY_FIT_WEIGHT` and `packages/scoring`'s thresholds already use.
// Named and adjustable in one place; covered by `job-relevance.test.ts`.
const SKILL_FIT_MAX_POINTS = 70;
const ROLE_MATCH_POINTS = 20;
const REMOTE_FIT_POINTS = 10;
const SENIORITY_MISMATCH_PENALTY = 10;
const NEGATIVE_KEYWORD_PENALTY = 35;

const HIGH_MATCH_THRESHOLD = 70;
const MEDIUM_MATCH_THRESHOLD = 40;

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export function tierForScore(score: number): JobRelevanceTier {
  if (score >= HIGH_MATCH_THRESHOLD) {
    return "high";
  }
  if (score >= MEDIUM_MATCH_THRESHOLD) {
    return "medium";
  }
  return "low";
}

/**
 * Word-boundary substring match — not plain `.includes()`, and not the
 * "pad the whole haystack with one space" trick this function replaced
 * (which only ever protected the string's outer edges, not internal word
 * boundaries: "lead" would still have matched inside "leadership"). `\b`
 * boundaries are what actually make a bare word like "hr" safe, the same
 * fix applied to `packages/classification`'s `skillKeywordClassifier`
 * after "rust" was found matching inside "Trust" on real production data
 * (Milestone 13 Phase 2) — this module has the identical risk (e.g. "hr"
 * inside a word, "lead" inside "leadership"), hardened here proactively
 * rather than waiting for its own production false positive.
 */
function matchesKeyword(haystack: string, keyword: string): boolean {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`, "i").test(haystack);
}

function findMatchingRoleSlug(title: string, targetRoleSlugs: readonly string[]): string | null {
  for (const slug of targetRoleSlugs) {
    const role = TARGET_ROLES[slug];
    if (role && role.titleKeywords.some((keyword) => matchesKeyword(title, keyword))) {
      return slug;
    }
  }
  return null;
}

function findNegativeKeyword(title: string): string | null {
  return NEGATIVE_TITLE_KEYWORDS.find((keyword) => matchesKeyword(title, keyword)) ?? null;
}

/**
 * Title-keyword seniority inference — deliberately conservative: most job
 * titles state no seniority level at all, and this returns `null` (not
 * "mid") whenever it finds no explicit signal, so the seniority component
 * above is excluded rather than guessed.
 */
export function inferSeniorityFromTitle(title: string): "senior" | "junior" | null {
  if (SENIOR_TITLE_KEYWORDS.some((keyword) => matchesKeyword(title, keyword))) {
    return "senior";
  }
  if (JUNIOR_TITLE_KEYWORDS.some((keyword) => matchesKeyword(title, keyword))) {
    return "junior";
  }
  return null;
}

function isRemoteSatisfied(
  preference: "remote_only" | "remote_friendly",
  workplaceType: "remote" | "hybrid" | "onsite",
): boolean {
  return preference === "remote_only" ? workplaceType === "remote" : workplaceType !== "onsite";
}

export function computeJobRelevance(
  job: JobRelevanceJobInput,
  jobSkillIds: readonly string[],
  profile: JobRelevanceProfile,
  skillNameById: ReadonlyMap<string, string>,
): JobRelevanceResult {
  const breakdown: JobRelevanceBreakdownEntry[] = [];
  let score = 0;

  // 1. Skill fit — always applicable, mirrors `computeMatch`'s own
  // "no tagged Skills" = 0 case; not excluded, since a Job's classified
  // Skills (or lack of them) is real evidence, not a data gap.
  const userSkillSet = new Set(profile.skillIds);
  const matchedSkillIds = jobSkillIds.filter((id) => userSkillSet.has(id));
  if (jobSkillIds.length > 0 && matchedSkillIds.length > 0) {
    const skillFit = matchedSkillIds.length / jobSkillIds.length;
    const skillPoints = skillFit * SKILL_FIT_MAX_POINTS;
    score += skillPoints;
    const perSkillPoints = roundTo(skillPoints / matchedSkillIds.length, 1);
    for (const skillId of matchedSkillIds) {
      breakdown.push({ label: skillNameById.get(skillId) ?? "Skill", weight: perSkillPoints });
    }
  }

  // 2. Target role match — excluded if the User hasn't configured any.
  if (profile.targetRoleSlugs.length > 0) {
    const matchedRoleSlug = findMatchingRoleSlug(job.title, profile.targetRoleSlugs);
    if (matchedRoleSlug) {
      score += ROLE_MATCH_POINTS;
      breakdown.push({
        label: `Target role: ${TARGET_ROLES[matchedRoleSlug]?.name ?? matchedRoleSlug}`,
        weight: ROLE_MATCH_POINTS,
      });
    }
  }

  // 3. Remote/workplace fit — excluded unless both the Job's
  // `workplaceType` and the User's preference are known and the
  // preference isn't "no opinion."
  if (
    job.workplaceType !== null &&
    profile.remotePreference !== null &&
    profile.remotePreference !== "no_preference"
  ) {
    const satisfied = isRemoteSatisfied(profile.remotePreference, job.workplaceType);
    const weight = satisfied ? REMOTE_FIT_POINTS : -REMOTE_FIT_POINTS;
    score += weight;
    breakdown.push({ label: satisfied ? "Remote fit" : "Workplace type mismatch", weight });
  }

  // 4. Seniority — excluded unless the title states a level AND the User
  // has a preference; a match contributes no separate bonus line (it's
  // simply not penalized) to avoid double-counting alongside skill fit.
  const jobSeniority = inferSeniorityFromTitle(job.title);
  if (jobSeniority !== null && profile.seniorityPreference.length > 0) {
    if (!profile.seniorityPreference.includes(jobSeniority)) {
      score -= SENIORITY_MISMATCH_PENALTY;
      breakdown.push({
        label: `Seniority mismatch (this posting reads as ${jobSeniority})`,
        weight: -SENIORITY_MISMATCH_PENALTY,
      });
    }
  }

  // 5. Negative keyword penalty — independent of any Profile data; a
  // title reading as AML/compliance/marketing/etc is evidence regardless
  // of what the User declared.
  const negativeMatch = findNegativeKeyword(job.title);
  if (negativeMatch) {
    score -= NEGATIVE_KEYWORD_PENALTY;
    breakdown.push({
      label: `Unrelated-role signal ("${negativeMatch.trim()}")`,
      weight: -NEGATIVE_KEYWORD_PENALTY,
    });
  }

  const clampedScore = Math.max(0, Math.min(100, Math.round(score)));

  return { score: clampedScore, tier: tierForScore(clampedScore), breakdown, matchedSkillIds };
}
