import type { SecurityTargetIntelligenceState } from "./types";

const SECURITY_OPPORTUNITY_MIN_SIGNAL_COUNT = 1;

/**
 * The gate a Security Target's Intelligence must satisfy for a (detected,
 * unscored) Security Opportunity to exist — deliberately trivial, per the
 * Phase 2B Step 1 brief: "Do NOT implement the final security opportunity
 * scoring model yet... Do not invent a final score." This is a
 * placeholder proving the Signal -> Opportunity path exists end to end,
 * not a judgment about which protocols are worth a researcher's time —
 * any signal at all is enough. A real, calibrated threshold (mirroring
 * `meetsOpportunityThreshold` in `packages/scoring`) is deferred to a
 * later phase, once the Phase 2A-proposed scoring dimensions have an
 * actual deterministic formula behind them.
 */
export function meetsSecurityOpportunityThreshold(
  intelligence: SecurityTargetIntelligenceState,
): boolean {
  return intelligence.signalCount >= SECURITY_OPPORTUNITY_MIN_SIGNAL_COUNT;
}

export function describeSecurityOpportunityThreshold(): string {
  return (
    `signalCount >= ${SECURITY_OPPORTUNITY_MIN_SIGNAL_COUNT} — a Phase 2B Step 1 placeholder ` +
    "gate, not a scoring model. See this function's doc comment."
  );
}
