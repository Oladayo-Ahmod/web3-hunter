/**
 * Deterministic Job-level relevance scoring (Milestone 13 Phase 2, revised
 * in Phase A of `docs/MILESTONE_13_DISCOVERY_AND_RELEVANCE_REVIEW.md`) —
 * the counterpart to `packages/matching`'s `computeMatch`, but for an
 * individual Job instead of a Company-level Opportunity. Same discipline:
 * pure, synchronous, no I/O, same inputs always produce the same output.
 *
 * Every component below that depends on optional User Profile data (role,
 * remote, seniority, location) is *excluded entirely* from scoring when
 * that data is missing on either side — not scored as a mismatch, not
 * scored as a neutral 0.5. "We don't know" must never look like "this
 * doesn't match," or the score would silently penalize jobs for data
 * gaps that have nothing to do with their actual relevance.
 *
 * The one component that is NOT excluded when a Job has zero detected
 * Skills is skill fit itself — that mirrors `computeMatch`'s own existing
 * behavior for an Opportunity with no tagged Skills (0, with a specific
 * reason, not "unknown").
 *
 * This function never filters — it only scores. Whether/how a caller uses
 * the score to sort or filter a feed is entirely `job-query-service.ts`'s
 * decision, not this module's.
 *
 * PHASE A REVISION — why the weights changed:
 * Real production data (Milestone 13 Phase 2 verification) found "Senior
 * Software Engineer, Frontend" scoring 70% for a security/protocol-
 * targeting profile, because it had exactly one classified Skill
 * ("Frontend Engineering") that happened to be in the User's Skill list —
 * `skillFit = 1/1 = 1.0`, alone enough to cross "high match" at the old
 * `SKILL_FIT_MAX_POINTS = 70`. Skill overlap was compensating for a
 * completely incompatible role. Role compatibility is now evaluated
 * first and dominates (`ROLE_MATCH_POINTS`/`ROLE_MISMATCH_PENALTY`, both
 * larger than the rescaled skill-fit ceiling), exactly per
 * `docs/MILESTONE_13_DISCOVERY_AND_RELEVANCE_REVIEW.md` §9.
 */

export const JOB_RELEVANCE_TIERS = ["high", "medium", "low", "very-low"] as const;
export type JobRelevanceTier = (typeof JOB_RELEVANCE_TIERS)[number];

export interface JobRelevanceBreakdownEntry {
  label: string;
  /** Signed points. Individual entries can exceed the displayed 0-100 `score`'s range before clamping — see `tierForScore`'s doc comment for why. */
  weight: number;
}

export interface JobRelevanceResult {
  /** Always 0-100 — clamped for display. `tier` is computed from the pre-clamp value, so two very-negative jobs can both show "0%" and still sort/tier differently; the breakdown explains why. */
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
  /** Free text (e.g. "Worldwide", "USA", "EMEA") — `null`/empty is today's real, common state and excludes the location component entirely. See `parseLocationScope`. */
  locationConstraint: string | null;
}

export interface JobRelevanceJobInput {
  title: string;
  departmentNames: readonly string[];
  workplaceType: "remote" | "hybrid" | "onsite" | null;
  locationName: string | null;
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
 * Role families clearly outside the `TARGET_ROLES` vocabulary — Milestone
 * 13 Phase A's "role compatibility gate" (docs/MILESTONE_13_DISCOVERY_AND_RELEVANCE_REVIEW.md
 * §8/§9). Used only to detect that a Job's title reads as a *different*,
 * known-incompatible role family when it doesn't match any of the User's
 * configured target roles — the mechanism that demotes "Senior Software
 * Engineer, Frontend" instead of letting a stray Skill overlap rescue it.
 * A title matching neither this list nor `TARGET_ROLES` is genuinely
 * unknown (e.g. a generic "Software Engineer") and stays excluded, per
 * this module's "absence is not a mismatch" rule.
 */
export const INCOMPATIBLE_ROLE_FAMILIES: Readonly<
  Record<string, { name: string; titleKeywords: readonly string[] }>
> = {
  frontend: {
    name: "Frontend Engineering",
    titleKeywords: ["frontend", "front-end", "front end", "ui engineer", "react developer"],
  },
  devrel: {
    name: "Developer Relations",
    titleKeywords: ["developer relations", "devrel", "developer advocate"],
  },
  product: {
    name: "Product",
    titleKeywords: ["product manager", "product designer", "product owner"],
  },
  marketing: { name: "Marketing", titleKeywords: ["marketing"] },
  "business-development": {
    name: "Business Development",
    titleKeywords: ["business development"],
  },
  sales: {
    name: "Sales",
    titleKeywords: ["account executive", "sales director", "sales manager", "sales lead"],
  },
  design: {
    name: "Design",
    titleKeywords: ["graphic designer", "brand designer", "ux designer"],
  },
  operations: { name: "Operations", titleKeywords: ["operations manager", "ops manager"] },
  compliance: { name: "Compliance", titleKeywords: ["compliance", "aml"] },
  finance: {
    name: "Finance",
    titleKeywords: ["accounting", "controller", "finance manager", "cfo"],
  },
};

/**
 * Roles clearly unrelated to Web3 engineering/security work — the
 * negative signal from the original Milestone 13 pivot request's §6,
 * applied here as a flat penalty rather than through the Skill taxonomy
 * (these aren't "absence of a skill," they're active evidence a role is
 * a mismatch). Deliberately overlaps some `INCOMPATIBLE_ROLE_FAMILIES`
 * entries (e.g. "marketing," "compliance") — that's two independent
 * signals agreeing, not a bug; a title can trip both.
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

// Priority order matters: checked most-specific-first so e.g. "Senior
// Staff Engineer" resolves to "staff" (not "senior"), and "Engineering
// Manager" resolves to "manager" even though it says nothing "senior."
const MANAGER_TITLE_KEYWORDS = ["manager", "director", "vp", "vice president", "head of"];
const STAFF_TITLE_KEYWORDS = ["staff", "principal"];
const SENIOR_TITLE_KEYWORDS = ["senior", "sr.", "lead"];
const JUNIOR_TITLE_KEYWORDS = ["junior", "jr.", "entry-level", "entry level", "intern"];

export type JobSeniorityLevel = "junior" | "senior" | "staff" | "manager";

/**
 * Full seniority-compatibility matrix (Milestone 13 Phase A §10) —
 * `SENIORITY_MATRIX[userPreference][jobLevel]`. Replaces the old binary
 * "matches preference or flat -10" rule, and closes a real, verified
 * gap: "Manager"/"Director" titles previously produced no seniority
 * signal at all (`inferSeniorityFromTitle` returned `null` for both —
 * confirmed against the shipped code before this revision).
 *
 * A missing cell (e.g. `mid.junior`) means "compatible, no bonus" (0) —
 * every cell is present below for explicitness rather than relying on
 * `undefined` defaulting to a coincidentally-correct 0.
 */
const SENIORITY_MATRIX: Readonly<Record<string, Readonly<Record<JobSeniorityLevel, number>>>> = {
  junior: { junior: 8, senior: -10, staff: -15, manager: -20 },
  mid: { junior: 0, senior: -5, staff: -10, manager: -15 },
  senior: { junior: -10, senior: 8, staff: 8, manager: -10 },
};

// v1, documented as v1 — a first, defensible weighting, not a calibrated
// model, the same framing `packages/matching`'s `SKILL_FIT_WEIGHT`/
// `TECHNOLOGY_FIT_WEIGHT` and `packages/scoring`'s thresholds already use.
// Named and adjustable in one place; covered by `job-relevance.test.ts`.
const SKILL_FIT_MAX_POINTS = 30; // was 70 — see the module doc comment's "why the weights changed"
const ROLE_MATCH_POINTS = 45; // was 20 — now the dominant positive signal
const ROLE_MISMATCH_PENALTY = 35; // new — the dominant negative signal
const REMOTE_FIT_POINTS = 10;
const LOCATION_FIT_POINTS = 10;
const NEGATIVE_KEYWORD_PENALTY = 35;

const HIGH_MATCH_THRESHOLD = 70;
const MEDIUM_MATCH_THRESHOLD = 40;
const LOW_MATCH_THRESHOLD = -20;

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/**
 * Buckets the *unclamped* raw score, not the displayed 0-100 `score` —
 * deliberately. A plain, unmatched job (raw 0) and a job with two
 * independent negative signals stacked (e.g. role mismatch *and* a
 * negative keyword, raw -70) would both clamp to a displayed "0%" if
 * tiering used the clamped value, collapsing "irrelevant" and
 * "aggressively unrelated" into the same bucket — exactly the "Frontend
 * Engineer -> low" vs. "Marketing Manager -> very low" distinction
 * Milestone 13 Phase A explicitly asked for.
 */
export function tierForScore(score: number): JobRelevanceTier {
  if (score >= HIGH_MATCH_THRESHOLD) {
    return "high";
  }
  if (score >= MEDIUM_MATCH_THRESHOLD) {
    return "medium";
  }
  if (score >= LOW_MATCH_THRESHOLD) {
    return "low";
  }
  return "very-low";
}

/**
 * Word-boundary substring match — not plain `.includes()`. `\b`
 * boundaries are what make a bare word like "hr" or "go" safe (found via
 * real production data: "rust" was matching inside "Trust" before this
 * fix — see `packages/classification`'s `skillKeywordClassifier`, fixed
 * the same way).
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

function findIncompatibleRoleFamily(title: string): { slug: string; name: string } | null {
  for (const [slug, family] of Object.entries(INCOMPATIBLE_ROLE_FAMILIES)) {
    if (family.titleKeywords.some((keyword) => matchesKeyword(title, keyword))) {
      return { slug, name: family.name };
    }
  }
  return null;
}

function findNegativeKeyword(title: string): string | null {
  return NEGATIVE_TITLE_KEYWORDS.find((keyword) => matchesKeyword(title, keyword)) ?? null;
}

/**
 * Title-keyword seniority inference — deliberately conservative: most job
 * titles state no seniority level at all, and this returns `null`
 * whenever it finds no explicit signal, so the seniority component above
 * is excluded rather than guessed. Checked most-specific-first: manager
 * beats staff beats senior beats junior, so "Senior Engineering Manager"
 * resolves to "manager" (the more consequential signal for someone
 * targeting an individual-contributor role), not "senior."
 */
export function inferSeniorityFromTitle(title: string): JobSeniorityLevel | null {
  if (MANAGER_TITLE_KEYWORDS.some((keyword) => matchesKeyword(title, keyword))) {
    return "manager";
  }
  if (STAFF_TITLE_KEYWORDS.some((keyword) => matchesKeyword(title, keyword))) {
    return "staff";
  }
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

type LocationScope =
  | { kind: "worldwide" }
  | { kind: "region"; region: string }
  | { kind: "country"; country: string }
  | { kind: "unspecified" };

// Small, fixed vocabularies — deterministic keyword containment, not
// geocoding or fuzzy matching. Extend the lists as real data shows gaps;
// an unrecognized free-text constraint parses to "unspecified" (excluded
// from scoring) rather than guessed at.
const WORLDWIDE_KEYWORDS = ["worldwide", "anywhere", "global", "no preference"];
const REGION_KEYWORDS = [
  "emea",
  "apac",
  "latam",
  "americas",
  "europe",
  "asia",
  "africa",
  "oceania",
];
const COUNTRY_KEYWORDS = [
  "usa",
  "united states",
  "uk",
  "united kingdom",
  "canada",
  "nigeria",
  "india",
  "germany",
  "france",
  "singapore",
];

/**
 * Parses a User's free-text `locationConstraint` (Milestone 13 Phase 2's
 * existing, currently-unused profile field — e.g. "Worldwide", "USA",
 * "EMEA") into a small closed vocabulary. `null`/empty (today's real,
 * common state — confirmed against production) and any unrecognized text
 * both parse to `"unspecified"`, which excludes the location component
 * from scoring entirely — never guessed, never penalized.
 */
export function parseLocationScope(constraint: string | null): LocationScope {
  if (!constraint || constraint.trim() === "") {
    return { kind: "unspecified" };
  }
  const normalized = constraint.trim().toLowerCase();
  if (WORLDWIDE_KEYWORDS.some((keyword) => normalized.includes(keyword))) {
    return { kind: "worldwide" };
  }
  const region = REGION_KEYWORDS.find((keyword) => normalized.includes(keyword));
  if (region) {
    return { kind: "region", region };
  }
  const country = COUNTRY_KEYWORDS.find((keyword) => normalized.includes(keyword));
  if (country) {
    return { kind: "country", country };
  }
  return { kind: "unspecified" };
}

/**
 * Location fit — excluded (returns `null`) whenever there's nothing to
 * compare: an unspecified/worldwide User preference (worldwide is
 * compatible with everything, so it's not discriminating evidence either
 * way — the same "no opinion" treatment `remotePreference: "no_preference"`
 * already gets), or a Job with no captured location text at all.
 */
function scoreLocationFit(
  scope: LocationScope,
  jobLocationName: string | null,
): JobRelevanceBreakdownEntry | null {
  if (scope.kind === "unspecified" || scope.kind === "worldwide") {
    return null;
  }
  if (!jobLocationName || jobLocationName.trim() === "") {
    return null;
  }
  const needle = scope.kind === "region" ? scope.region : scope.country;
  const satisfied = jobLocationName.toLowerCase().includes(needle);
  return satisfied
    ? {
        label: `Location matches your ${needle.toUpperCase()} preference`,
        weight: LOCATION_FIT_POINTS,
      }
    : {
        label: `Location does not mention your ${needle.toUpperCase()} preference`,
        weight: -LOCATION_FIT_POINTS,
      };
}

export function computeJobRelevance(
  job: JobRelevanceJobInput,
  jobSkillIds: readonly string[],
  profile: JobRelevanceProfile,
  skillNameById: ReadonlyMap<string, string>,
): JobRelevanceResult {
  const breakdown: JobRelevanceBreakdownEntry[] = [];
  let score = 0;

  // 1. Role compatibility — evaluated first and weighted to dominate,
  // per Milestone 13 Phase A. Excluded entirely if the User hasn't
  // configured any target roles (nothing to be compatible/incompatible
  // *with* yet).
  if (profile.targetRoleSlugs.length > 0) {
    const matchedRoleSlug = findMatchingRoleSlug(job.title, profile.targetRoleSlugs);
    if (matchedRoleSlug) {
      score += ROLE_MATCH_POINTS;
      breakdown.push({
        label: `Target role: ${TARGET_ROLES[matchedRoleSlug]?.name ?? matchedRoleSlug}`,
        weight: ROLE_MATCH_POINTS,
      });
    } else {
      const incompatible = findIncompatibleRoleFamily(job.title);
      if (incompatible) {
        score -= ROLE_MISMATCH_PENALTY;
        breakdown.push({
          label: `Role mismatch (reads as ${incompatible.name}, not one of your target roles)`,
          weight: -ROLE_MISMATCH_PENALTY,
        });
      }
      // Neither a target-role match nor a known-incompatible family:
      // genuinely unknown (e.g. a generic "Software Engineer") — no
      // signal, no breakdown line, consistent with every other
      // optional component's "absence is not a mismatch" rule.
    }
  }

  // 2. Skill fit — rescaled down from 70 to 30 (see module doc comment).
  // Always applicable, mirrors `computeMatch`'s own "no tagged Skills" =
  // 0 case; not excluded, since a Job's classified Skills (or lack of
  // them) is real evidence, not a data gap.
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

  // 3. Seniority compatibility — full matrix (§ module doc comment),
  // excluded unless the title states a level AND the User has at least
  // one preference. Multiple preferences (e.g. "junior" and "mid" both
  // selected) take the most favorable applicable cell — compatible with
  // *any* selected level counts as compatible.
  const jobSeniority = inferSeniorityFromTitle(job.title);
  if (jobSeniority !== null && profile.seniorityPreference.length > 0) {
    const applicable = profile.seniorityPreference
      .map((preference) => SENIORITY_MATRIX[preference]?.[jobSeniority])
      .filter((value): value is number => value !== undefined);
    if (applicable.length > 0) {
      const weight = Math.max(...applicable);
      score += weight;
      breakdown.push({
        label:
          weight >= 0
            ? `Seniority compatible (this posting reads as ${jobSeniority})`
            : `Seniority mismatch (this posting reads as ${jobSeniority})`,
        weight,
      });
    }
  }

  // 4. Location compatibility — new (Milestone 13 Phase A §11).
  const locationEntry = scoreLocationFit(
    parseLocationScope(profile.locationConstraint),
    job.locationName,
  );
  if (locationEntry) {
    score += locationEntry.weight;
    breakdown.push(locationEntry);
  }

  // 5. Remote/workplace preference — excluded unless both the Job's
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
    breakdown.push({
      label: satisfied ? "Workplace preference satisfied" : "Workplace type mismatch",
      weight,
    });
  }

  // 6. Negative keyword penalty — independent of any Profile data; a
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

  // Tier is computed from the raw, unclamped score (see `tierForScore`'s
  // doc comment); only the displayed `score` is clamped to 0-100.
  const tier = tierForScore(score);
  const clampedScore = Math.max(0, Math.min(100, Math.round(score)));

  return { score: clampedScore, tier, breakdown, matchedSkillIds };
}
