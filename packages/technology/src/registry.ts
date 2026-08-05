import type { TechnologyDetector } from "./types";

const detectors: TechnologyDetector[] = [];

/**
 * Registers a Technology Detector to be run by `runTechnologyPipeline` for
 * every triggering Event — the same open-registration pattern
 * `packages/scoring`'s `registerSignalDetector` and
 * `packages/classification`'s `registerSkillClassifier` use, which is
 * what makes adding a new detector (or, later, a new evidence source) an
 * additive change requiring no modification to the pipeline runner.
 */
export function registerTechnologyDetector(detector: TechnologyDetector): void {
  detectors.push(detector);
}

export function listTechnologyDetectors(): readonly TechnologyDetector[] {
  return detectors;
}
