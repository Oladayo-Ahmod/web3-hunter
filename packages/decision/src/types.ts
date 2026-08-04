export type RecommendationStatus = "active" | "dismissed" | "archived" | "expired";

/**
 * Everything a Decision Rule needs to evaluate whether a Match is
 * eligible to become (or remain) an active Recommendation — deliberately
 * narrower than the full `match`/`opportunity`/`company_intelligence`
 * rows, the same discipline `packages/scoring`'s `SignalDetectionContext`
 * follows for its detectors.
 */
export interface DecisionRuleContext {
  matchScore: number;
  matchComputedAt: Date;
  intelligenceConfidence: number;
  intelligenceAsOf: Date;
  opportunityStatus: "detected" | "scored";
  /** Never wall-clock "now" inside a rule — see docs/ROADMAP.md Milestone 3's equivalent discipline. */
  asOf: Date;
}

/** A rule's verdict when it vetoes eligibility. `null` means the rule found no objection. */
export interface DecisionRuleViolation {
  ruleName: string;
  reasonCode: string;
  reasonDetails: Record<string, unknown>;
}

/**
 * A pure, synchronous eligibility gate. Every registered rule runs
 * against the same context; the first violation found makes a Match
 * ineligible for a new Recommendation. Unlike `packages/scoring`'s
 * `SignalDetector` (independent contributions, OR semantics), Decision
 * Rules are AND/veto semantics: every rule must pass.
 */
export type DecisionRule = (context: DecisionRuleContext) => DecisionRuleViolation | null;

/** The inputs `computePriority` derives a Recommendation's priority from. Match owns score; Decision owns priority. */
export interface PriorityInputs {
  matchScore: number;
  intelligenceConfidence: number;
  intelligenceAsOf: Date;
  recommendationCreatedAt: Date;
  asOf: Date;
}

export interface RecommendationReason {
  reasonCode: string;
  reasonDetails: Record<string, unknown>;
  reasonVersion: number;
}
