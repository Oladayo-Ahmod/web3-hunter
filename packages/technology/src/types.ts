/**
 * A minimal, source-agnostic view of an Event, supplied to Technology
 * Detectors — deliberately the same shape `packages/scoring`'s
 * `RecentCompanyEvent` and `packages/classification`'s equivalent use,
 * for the same reason: a Detector doesn't need collector identity,
 * confidence, or provenance, just enough to interpret what happened.
 */
export interface RecentCompanyEvent {
  id: string;
  type: string;
  occurredAt: Date;
  metadata: unknown;
}

/** One entry from the Skill taxonomy (`packages/db`'s `skill` table) — the same shared vocabulary `packages/classification` tags Opportunities with. */
export interface SkillTaxonomyEntry {
  id: string;
  slug: string;
  name: string;
}

/**
 * Everything a Technology Detector needs beyond the triggering Event
 * itself. Supplying the taxonomy via context (rather than the detector
 * querying `packages/db` itself) is what keeps detectors pure,
 * synchronous, and trivially unit-testable — the same discipline
 * `packages/scoring`'s `SignalDetector` and `packages/classification`'s
 * `SkillClassifier` follow.
 */
export interface TechnologyDetectionContext {
  skills: readonly SkillTaxonomyEntry[];
}

export interface TechnologyDetectionCandidate {
  skillId: string;
  /** 0..1: how confident this detector is that the Company's GitHub activity evidences this Skill. */
  confidence: number;
  reasoning: string;
  /** Provenance: which Event(s) justify this detection. Always non-empty. */
  sourceEventIds: readonly string[];
}

/**
 * A pure, synchronous transform from a triggering Event (plus context) to
 * zero or more Technology detections — the Technology Intelligence
 * counterpart to `packages/scoring`'s `SignalDetector` and
 * `packages/classification`'s `SkillClassifier`. Only a GitHub language/
 * topic detector exists today; further evidence sources (a second VCS, a
 * package-manifest reader) are expected to register their own detectors
 * against this same contract, the same additive way Signal detectors are
 * added.
 */
export type TechnologyDetector = (
  triggeringEvent: RecentCompanyEvent,
  context: TechnologyDetectionContext,
) => readonly TechnologyDetectionCandidate[];

/** The rebuildable rollup of a Company's evidenced technologies — mirrors `packages/scoring`'s `CompanyIntelligenceState`. */
export interface CompanyTechnologyProfileState {
  skillIds: readonly string[];
  evidenceCount: number;
}

/** One `technology_detection` row's shape, as consumed when rebuilding a Company Technology Profile. */
export interface TechnologyDetectionSummary {
  id: string;
  skillId: string;
  detectedAt: Date;
}
