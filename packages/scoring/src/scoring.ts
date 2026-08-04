import type { CompanyIntelligenceState, SignalSummary } from "./types";

const SIGNAL_WEIGHT_FACTOR = 0.6;
const INTELLIGENCE_CONFIDENCE_FACTOR = 0.4;

export interface OpportunityScoreResult {
  score: number;
  reasoning: string;
}

/**
 * Scoring Engine v1: computes an Opportunity's hiring-likelihood score
 * exclusively from Signals and Company Intelligence — this function's
 * input type has no Event access at all, which is what
 * docs/ROADMAP.md Milestone 3's acceptance criterion 4 ("the Scoring
 * Engine should consume Signals, not raw Events") means mechanically, not
 * just by convention.
 *
 * A weighted blend of the average strength of the Signals behind this
 * Opportunity and the Company's overall Intelligence confidence — a
 * first, documented, defensible formula (see docs/ROADMAP.md Milestone 3),
 * not a calibrated model. Deterministic and reproducible: the same
 * Signals and Intelligence state always produce the same score.
 */
export function computeOpportunityScore(
  signals: readonly SignalSummary[],
  intelligence: CompanyIntelligenceState,
): OpportunityScoreResult {
  const averageSignalWeight =
    signals.length > 0
      ? signals.reduce((sum, signal) => sum + signal.weight, 0) / signals.length
      : 0;

  const rawScore =
    averageSignalWeight * SIGNAL_WEIGHT_FACTOR +
    intelligence.confidence * INTELLIGENCE_CONFIDENCE_FACTOR;
  const score = Math.round(Math.min(Math.max(rawScore, 0), 1) * 100) / 100;

  const reasoning =
    `Score ${score.toFixed(2)} = (average Signal weight ${averageSignalWeight.toFixed(2)} across ` +
    `${signals.length} Signal(s)) x ${SIGNAL_WEIGHT_FACTOR} + (Intelligence confidence ` +
    `${intelligence.confidence.toFixed(2)}, trend: ${intelligence.trend}) x ${INTELLIGENCE_CONFIDENCE_FACTOR}.`;

  return { score, reasoning };
}
