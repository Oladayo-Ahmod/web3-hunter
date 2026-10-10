// Importing these registers the DefiLlama and Immunefi Security Signal
// detectors (see those modules) as a load-time side effect — the same
// convention packages/scoring uses for its Hiring Signal detectors.
import "./detectors/defillama-detectors";
import "./detectors/immunefi-detectors";

export { isBountyProgramExpired } from "./detectors/immunefi-detectors";

export {
  createAuditContest,
  getAuditContestById,
  type CreateAuditContestInput,
} from "./audit-contest-store";
export {
  getBugBountyById,
  getBugBountyByTargetAndPlatform,
  upsertBugBounty,
  type UpsertBugBountyInput,
} from "./bug-bounty-store";
export {
  SecurityIntelligenceUpdated,
  SecurityOpportunityDetected,
  SecuritySignalDetected,
} from "./event-types";
export {
  AUDIT_CONTEST,
  ACTIVE_PROTOCOL,
  BUG_BOUNTY,
  DISCLOSURE,
  SECURITY_RESEARCH,
  SHADOW_AUDIT,
  deriveSecurityOpportunityId,
  type SecurityOpportunityIdentity,
} from "./opportunity-id";
export {
  doesSignalTypeNameSpecificArtifact,
  doesSignalTypeQualifyForOpportunity,
  isRegisteredSecuritySignalType,
  listSecuritySignalDetectors,
  listSecuritySignalTypes,
  registerSecuritySignalDetector,
  registerSecuritySignalType,
  type SecuritySignalTypeOptions,
} from "./registry";
export { computeSecurityDetectionWindow } from "./security-detection-window";
export {
  computeSecurityTargetIntelligence,
  securityIntelligenceStatesEqual,
} from "./security-intelligence";
export { updateSecurityTargetIntelligence } from "./security-intelligence-update";
export {
  createSecurityOpportunity,
  getSecurityOpportunity,
  type CreateSecurityOpportunityInput,
} from "./security-opportunity-store";
export {
  describeSecurityOpportunityThreshold,
  meetsSecurityOpportunityThreshold,
} from "./security-opportunity-detection";
export {
  evaluateSecurityOpportunity,
  type SecurityOpportunityEvaluationResult,
} from "./security-opportunity-evaluation";
export { recordSecuritySignal } from "./security-signal-generation";
export {
  persistSecuritySignal,
  listSecuritySignalsForTarget,
  type PersistSecuritySignalInput,
} from "./security-signal-store";
export {
  SecurityTargetIdentityCollisionError,
  createSecurityTarget,
  getRawPayloadFromCollector,
  getSecurityTargetById,
  getSecurityTargetBySlug,
  resolveSecurityTarget,
  resolveSecurityTargetWithCollisionCheck,
  updateSecurityTargetRepositoryUrlIfMissing,
  type CreateSecurityTargetInput,
} from "./security-target-store";
export {
  getSecurityTargetIntelligence,
  upsertSecurityTargetIntelligence,
  type UpsertSecurityTargetIntelligenceInput,
} from "./security-target-intelligence-store";
export {
  runSecurityScoringPipeline,
  type SecurityScoringPipelineResult,
} from "./run-security-scoring-pipeline";
export type {
  RecentSecurityTargetEvent,
  SecurityIntelligenceTrend,
  SecuritySignalCandidate,
  SecuritySignalDetectionContext,
  SecuritySignalDetector,
  SecuritySignalSummary,
  SecurityTargetIntelligenceState,
} from "./types";
