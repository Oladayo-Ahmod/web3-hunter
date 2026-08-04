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
 * Skills — the score plus the matched Skills and reasoning behind it, per
 * docs/DOMAIN_MODEL.md's *Match ≠ Score* distinction.
 */
export interface MatchComputation {
  score: number;
  matchedSkillIds: readonly string[];
  reasoning: string;
}
