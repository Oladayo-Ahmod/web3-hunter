// Importing this registers the language/topic Technology Detector as a
// load-time side effect — the same convention packages/scoring's
// detectors and packages/classification's classifiers use.
import "./detectors/language-topic-detector";

export {
  rebuildCompanyTechnologyProfile,
  updateCompanyTechnologyProfile,
} from "./company-technology-profile-store";
export { TechnologyDetected } from "./event-types";
export { listTechnologyDetectors, registerTechnologyDetector } from "./registry";
export { runTechnologyPipeline, type TechnologyPipelineResult } from "./run-technology-pipeline";
export { persistTechnologyDetection } from "./technology-detection-store";
export {
  computeCompanyTechnologyProfile,
  technologyProfileStatesEqual,
} from "./technology-profile";
export type {
  CompanyTechnologyProfileState,
  RecentCompanyEvent,
  SkillTaxonomyEntry,
  TechnologyDetectionCandidate,
  TechnologyDetectionContext,
  TechnologyDetectionSummary,
  TechnologyDetector,
} from "./types";
