/**
 * A User's current matching-relevant state (docs/DOMAIN_MODEL.md §User
 * Profile): their declared Skills — the canonical input to Match
 * computation — and their deal-breaker Skills, a hard exclusion filter.
 */
export interface UserProfileState {
  userId: string;
  skillIds: readonly string[];
  dealBreakerSkillIds: readonly string[];
}

/**
 * The result of comparing a User's Skills against an Opportunity's tagged
 * Skills — and, per Milestone 9, its Company's GitHub-evidenced
 * technologies — into a score plus the matched Skills and reasoning
 * behind it, per docs/DOMAIN_MODEL.md's *Match ≠ Score* distinction.
 * `matchedTechnologySkillIds` is empty (not zero-overlap-scored) when the
 * Company has no Technology Profile yet — absence, not a penalty.
 */
export interface MatchComputation {
  score: number;
  matchedSkillIds: readonly string[];
  matchedTechnologySkillIds: readonly string[];
  reasoning: string;
}
