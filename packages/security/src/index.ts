// Importing this registers the DefiLlama Security Signal detectors (see
// that module) as a load-time side effect — the same convention
// packages/scoring uses for its Hiring Signal detectors.
import "./detectors/defillama-detectors";

export {
  createAuditContest,
  getAuditContestById,
  type CreateAuditContestInput,
} from "./audit-contest-store";
export { createBugBounty, getBugBountyById, type CreateBugBountyInput } from "./bug-bounty-store";
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
  isRegisteredSecuritySignalType,
  listSecuritySignalDetectors,
  listSecuritySignalTypes,
  registerSecuritySignalDetector,
  registerSecuritySignalType,
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
  createSecurityTarget,
  getSecurityTargetById,
  getSecurityTargetBySlug,
  resolveSecurityTarget,
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
