// Importing these registers the four Decision Rules as a load-time side
// effect — the same convention packages/scoring's detectors and
// packages/classification's classifiers use.
import "./rules/relevance-threshold-rule";
import "./rules/confidence-threshold-rule";
import "./rules/freshness-rule";
import "./rules/opportunity-scored-rule";

export * from "./constants";
export {
  RecommendationArchived,
  RecommendationCreated,
  RecommendationDismissed,
  RecommendationExpired,
  RecommendationRestored,
} from "./event-types";
export { computePriority } from "./priority";
export { ELIGIBLE_REASON_CODE, REASON_VERSION } from "./reason-codes";
export { deriveRecommendationId } from "./recommendation-id";
export {
  archiveRecommendation,
  deriveRecommendationCreatedEventId,
  dismissRecommendation,
  evaluateRecommendationForMatch,
  restoreRecommendation,
  type RecommendationEvaluationResult,
} from "./recommendation-store";
export { evaluateEligibility, listDecisionRules, registerDecisionRule } from "./registry";
export {
  RELEVANCE_THRESHOLD_REASON_CODE,
  relevanceThresholdRule,
} from "./rules/relevance-threshold-rule";
export {
  CONFIDENCE_THRESHOLD_REASON_CODE,
  confidenceThresholdRule,
} from "./rules/confidence-threshold-rule";
export { FRESHNESS_REASON_CODE, freshnessRule } from "./rules/freshness-rule";
export {
  OPPORTUNITY_NOT_SCORED_REASON_CODE,
  opportunityScoredRule,
} from "./rules/opportunity-scored-rule";
export { runDecisionPipeline, type DecisionPipelineResult } from "./run-decision-pipeline";
export {
  canTransition,
  InvalidRecommendationTransitionError,
  transition,
  type RecommendationTransitionAction,
} from "./state-machine";
export type {
  DecisionRule,
  DecisionRuleContext,
  DecisionRuleViolation,
  PriorityInputs,
  RecommendationReason,
  RecommendationStatus,
} from "./types";
export { selectDigestCandidates, type DigestCandidateInput } from "./digest";
export {
  evaluateFollowUpSchedule,
  type FollowUpDecision,
  type FollowUpScheduleInput,
} from "./follow-up";
