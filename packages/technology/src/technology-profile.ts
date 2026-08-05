import type { CompanyTechnologyProfileState, TechnologyDetectionSummary } from "./types";

/**
 * Computes a Company's current Technology Profile from its full
 * `technology_detection` history — a plain aggregation (the union of
 * evidenced Skills), not a statistically computed trend/confidence the
 * way `packages/scoring`'s `computeCompanyIntelligence` is. Pure and
 * deterministic: the same detections always produce the same state,
 * which is what makes both live updates and full replay-rebuilds
 * (`rebuildCompanyTechnologyProfile`) produce identical results.
 */
export function computeCompanyTechnologyProfile(
  detections: readonly TechnologyDetectionSummary[],
): CompanyTechnologyProfileState {
  const skillIds = [...new Set(detections.map((detection) => detection.skillId))].sort();

  return { skillIds, evidenceCount: detections.length };
}

/** Whether two Technology Profile states differ in any field a consumer could observe. */
export function technologyProfileStatesEqual(
  a: CompanyTechnologyProfileState,
  b: CompanyTechnologyProfileState,
): boolean {
  if (a.evidenceCount !== b.evidenceCount || a.skillIds.length !== b.skillIds.length) {
    return false;
  }
  return a.skillIds.every((skillId, index) => skillId === b.skillIds[index]);
}
