import type { MatchComputation } from "./types";

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/**
 * Compares a User's declared Skills against an Opportunity's tagged
 * Skills (`packages/classification`'s `opportunity_skill` output) into a
 * score and explicit reasoning — pure and deterministic: the same two
 * Skill sets always produce the same result, which is what Milestone 5's
 * Definition of Ready requires and is verified by a replay-style test.
 *
 * Score is the fraction of the Opportunity's tagged Skills the User has —
 * a first, defensible formula (see docs/ROADMAP.md Milestone 3's
 * equivalent note for Scoring Engine v1), not a calibrated model.
 */
export function computeMatch(
  userSkillIds: readonly string[],
  opportunitySkillIds: readonly string[],
): MatchComputation {
  if (opportunitySkillIds.length === 0) {
    return {
      score: 0,
      matchedSkillIds: [],
      reasoning: "This Opportunity has no tagged Skills to match against yet.",
    };
  }

  const userSkillSet = new Set(userSkillIds);
  const matchedSkillIds = opportunitySkillIds.filter((skillId) => userSkillSet.has(skillId));
  const score = roundTo(matchedSkillIds.length / opportunitySkillIds.length, 2);

  const reasoning =
    matchedSkillIds.length > 0
      ? `Matches ${matchedSkillIds.length} of ${opportunitySkillIds.length} tagged Skill(s) for this Opportunity.`
      : `No overlap with this Opportunity's ${opportunitySkillIds.length} tagged Skill(s).`;

  return { score, matchedSkillIds, reasoning };
}

/** Whether two Match computations differ in any field a consumer could observe. */
export function matchComputationsEqual(a: MatchComputation, b: MatchComputation): boolean {
  const sortedA = [...a.matchedSkillIds].sort();
  const sortedB = [...b.matchedSkillIds].sort();

  return (
    a.score === b.score &&
    a.reasoning === b.reasoning &&
    sortedA.length === sortedB.length &&
    sortedA.every((id, index) => id === sortedB[index])
  );
}
