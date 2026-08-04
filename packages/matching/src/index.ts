export { MatchComputed } from "./event-types";
export { deriveMatchId, type MatchIdentity } from "./match-id";
export { evaluateMatch, type MatchEvaluationResult } from "./match-store";
export { computeMatch, matchComputationsEqual } from "./matching";
export { runMatchingPipeline, type MatchingPipelineResult } from "./run-matching-pipeline";
export type { MatchComputation, UserProfileState } from "./types";
export {
  ensureUserProfile,
  getUserProfile,
  setDealBreakerSkills,
  setUserSkills,
} from "./user-profile-store";
