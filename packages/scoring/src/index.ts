// Importing this registers the four Hiring Signal detectors (see that
// module) as a load-time side effect — the same convention
// packages/collectors/greenhouse uses for its Event Types.
import "./detectors/hiring-detectors";

export {
  rebuildCompanyIntelligence,
  updateCompanyIntelligence,
} from "./company-intelligence-store";
export { computeDetectionWindow } from "./detection-window";
export {
  HiringSignalDetected,
  IntelligenceUpdated,
  OpportunityDetected,
  OpportunityScored,
} from "./event-types";
export { computeCompanyIntelligence, intelligenceStatesEqual } from "./intelligence";
export { describeOpportunityThreshold, meetsOpportunityThreshold } from "./opportunity-detection";
export {
  ENGINEERING_HIRING_SURGE,
  deriveOpportunityId,
  type OpportunityIdentity,
} from "./opportunity-id";
export { evaluateOpportunity, type OpportunityEvaluationResult } from "./opportunity-store";
export {
  isRegisteredSignalType,
  listSignalDetectors,
  listSignalTypes,
  registerSignalDetector,
  registerSignalType,
} from "./registry";
export { runScoringPipeline, type ScoringPipelineResult } from "./run-scoring-pipeline";
export { computeOpportunityScore, type OpportunityScoreResult } from "./scoring";
export { persistSignal } from "./signal-generation";
export type {
  CompanyIntelligenceState,
  IntelligenceTrend,
  RecentCompanyEvent,
  SignalCandidate,
  SignalDetectionContext,
  SignalDetector,
  SignalSummary,
} from "./types";
