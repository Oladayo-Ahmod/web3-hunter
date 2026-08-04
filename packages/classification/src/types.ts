/**
 * A minimal, source-agnostic view of an Event, supplied to Classifiers —
 * deliberately the same shape `packages/scoring`'s `RecentCompanyEvent`
 * uses, for the same reason: a Classifier doesn't need collector identity,
 * confidence, or provenance, just enough to interpret what happened.
 */
export interface RecentCompanyEvent {
  id: string;
  type: string;
  occurredAt: Date;
  metadata: unknown;
}

/** One entry from the Skill taxonomy (`packages/db`'s `skill` table). */
export interface SkillTaxonomyEntry {
  id: string;
  slug: string;
  name: string;
}

/**
 * Everything a Skill Classifier needs beyond the triggering Event itself.
 * Supplying the taxonomy via context (rather than the classifier querying
 * `packages/db` itself) is what keeps classifiers pure, synchronous, and
 * trivially unit-testable — the same discipline
 * `packages/scoring`'s `SignalDetector` follows.
 */
export interface ClassificationContext {
  skills: readonly SkillTaxonomyEntry[];
}

export interface SkillClassificationCandidate {
  skillId: string;
  /** 0..1: how confident this classifier is that the Skill applies. */
  confidence: number;
  reasoning: string;
  /** Provenance: which Event(s) justify this classification. Always non-empty. */
  sourceEventIds: readonly string[];
}

/**
 * A pure, synchronous transform from a triggering Event (plus context) to
 * zero or more Skill classifications. Only Skill classification exists
 * today; further metadata categories (technologies, languages, chains,
 * seniority, employment type) are expected to follow the same shape —
 * their own candidate/classifier types and their own `packages/db` table,
 * added the same additive way `packages/scoring`'s Signal detectors are —
 * not introduced speculatively here ahead of need.
 */
export type SkillClassifier = (
  triggeringEvent: RecentCompanyEvent,
  context: ClassificationContext,
) => readonly SkillClassificationCandidate[];
