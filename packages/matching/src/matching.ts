import { SKILL_FIT_WEIGHT, TECHNOLOGY_FIT_WEIGHT } from "./constants";
import type { MatchComputation } from "./types";

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function buildReasoning(input: {
  matchedSkillIds: readonly string[];
  opportunitySkillIds: readonly string[];
  matchedTechnologySkillIds: readonly string[];
  companyTechnologySkillIds: readonly string[];
  hasTechnologyEvidence: boolean;
}): string {
  const skillPart =
    input.matchedSkillIds.length > 0
      ? `Matches ${input.matchedSkillIds.length} of ${input.opportunitySkillIds.length} tagged Skill(s) for this Opportunity.`
      : `No overlap with this Opportunity's ${input.opportunitySkillIds.length} tagged Skill(s).`;

  if (!input.hasTechnologyEvidence) {
    return skillPart;
  }

  const technologyPart =
    input.matchedTechnologySkillIds.length > 0
      ? `Also matches ${input.matchedTechnologySkillIds.length} of ${input.companyTechnologySkillIds.length} technologies evidenced by this Company's GitHub activity.`
      : `No overlap with this Company's ${input.companyTechnologySkillIds.length} GitHub-evidenced technologies.`;

  return `${skillPart} ${technologyPart}`;
}

/**
 * Compares a User's declared Skills against an Opportunity's tagged
 * Skills (`packages/classification`'s `opportunity_skill` output) and,
 * per Milestone 9, its Company's GitHub-evidenced technologies
 * (`packages/technology`'s `company_technology_profile`) into a score and
 * explicit reasoning — pure and deterministic: the same inputs always
 * produce the same result, which is what Milestone 5's Definition of
 * Ready requires and is verified by a replay-style test.
 *
 * Score is a weighted blend of Skill fit (the fraction of the
 * Opportunity's tagged Skills the User has) and Technology fit (the
 * fraction of the Company's evidenced technologies the User has),
 * per `./constants.ts`'s named weights — a first, defensible formula
 * (see docs/ROADMAP.md Milestone 3's equivalent note for Scoring Engine
 * v1), not a calibrated model. When the Company has no Technology Profile
 * yet, `companyTechnologySkillIds` defaults to empty and the score
 * degrades gracefully to Skill fit alone — unchanged from this function's
 * pre-Milestone-9 behavior, never silently skewed by absent evidence.
 */
export function computeMatch(
  userSkillIds: readonly string[],
  opportunitySkillIds: readonly string[],
  companyTechnologySkillIds: readonly string[] = [],
): MatchComputation {
  if (opportunitySkillIds.length === 0) {
    return {
      score: 0,
      matchedSkillIds: [],
      matchedTechnologySkillIds: [],
      reasoning: "This Opportunity has no tagged Skills to match against yet.",
    };
  }

  const userSkillSet = new Set(userSkillIds);

  const matchedSkillIds = opportunitySkillIds.filter((skillId) => userSkillSet.has(skillId));
  const skillFit = matchedSkillIds.length / opportunitySkillIds.length;

  const hasTechnologyEvidence = companyTechnologySkillIds.length > 0;
  const matchedTechnologySkillIds = companyTechnologySkillIds.filter((skillId) =>
    userSkillSet.has(skillId),
  );
  const technologyFit = hasTechnologyEvidence
    ? matchedTechnologySkillIds.length / companyTechnologySkillIds.length
    : 0;

  const score = hasTechnologyEvidence
    ? roundTo(skillFit * SKILL_FIT_WEIGHT + technologyFit * TECHNOLOGY_FIT_WEIGHT, 2)
    : roundTo(skillFit, 2);

  const reasoning = buildReasoning({
    matchedSkillIds,
    opportunitySkillIds,
    matchedTechnologySkillIds,
    companyTechnologySkillIds,
    hasTechnologyEvidence,
  });

  return { score, matchedSkillIds, matchedTechnologySkillIds, reasoning };
}

/** Whether two Match computations differ in any field a consumer could observe. */
export function matchComputationsEqual(a: MatchComputation, b: MatchComputation): boolean {
  const sortedSkillA = [...a.matchedSkillIds].sort();
  const sortedSkillB = [...b.matchedSkillIds].sort();
  const sortedTechA = [...a.matchedTechnologySkillIds].sort();
  const sortedTechB = [...b.matchedTechnologySkillIds].sort();

  return (
    a.score === b.score &&
    a.reasoning === b.reasoning &&
    sortedSkillA.length === sortedSkillB.length &&
    sortedSkillA.every((id, index) => id === sortedSkillB[index]) &&
    sortedTechA.length === sortedTechB.length &&
    sortedTechA.every((id, index) => id === sortedTechB[index])
  );
}
