// Importing this registers the Skill keyword classifier as a load-time
// side effect — the same convention packages/scoring's detectors use.
import "./classifiers/skill-classifier";

export { persistJobSkill, persistOpportunitySkill } from "./classification-store";
export { JobSkillDetected, OpportunitySkillDetected } from "./event-types";
export { listSkillClassifiers, registerSkillClassifier } from "./registry";
export {
  runClassificationPipeline,
  type ClassificationPipelineResult,
} from "./run-classification-pipeline";
export {
  runJobClassificationPipeline,
  type JobClassificationPipelineResult,
} from "./run-job-classification-pipeline";
export type {
  ClassificationContext,
  RecentCompanyEvent,
  SkillClassificationCandidate,
  SkillClassifier,
  SkillTaxonomyEntry,
} from "./types";
