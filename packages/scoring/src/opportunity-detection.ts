import type { CompanyIntelligenceState } from "./types";

const OPPORTUNITY_CONFIDENCE_THRESHOLD = 0.5;
const OPPORTUNITY_MIN_SIGNAL_COUNT = 2;

/**
 * The deterministic rule an Opportunity's existence depends on, per
 * docs/ROADMAP.md Milestone 3 ("An Opportunity should only exist when
 * predefined conditions are satisfied"). A first, documented, defensible
 * threshold — not a calibrated model (see docs/ROADMAP.md Milestone 3's
 * own framing of this as v1).
 */
export function meetsOpportunityThreshold(intelligence: CompanyIntelligenceState): boolean {
  return (
    intelligence.confidence >= OPPORTUNITY_CONFIDENCE_THRESHOLD &&
    intelligence.signalCount >= OPPORTUNITY_MIN_SIGNAL_COUNT &&
    intelligence.trend !== "decreasing"
  );
}

export function describeOpportunityThreshold(): string {
  return (
    `confidence >= ${OPPORTUNITY_CONFIDENCE_THRESHOLD}, signalCount >= ${OPPORTUNITY_MIN_SIGNAL_COUNT}, ` +
    "trend != decreasing"
  );
}
