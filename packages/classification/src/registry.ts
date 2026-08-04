import type { SkillClassifier } from "./types";

const classifiers: SkillClassifier[] = [];

/**
 * Registers a Skill Classifier to be run by `runClassificationPipeline`
 * for every triggering Event — the same open-registration pattern
 * `packages/scoring`'s `registerSignalDetector` uses, which is what makes
 * adding a new classifier (or, later, a new metadata category) an
 * additive change requiring no modification to the pipeline runner.
 */
export function registerSkillClassifier(classifier: SkillClassifier): void {
  classifiers.push(classifier);
}

export function listSkillClassifiers(): readonly SkillClassifier[] {
  return classifiers;
}
