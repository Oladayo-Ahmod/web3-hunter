import { doesSignalTypeQualifyForOpportunity } from "./registry";

/**
 * The gate a Security Target's accumulated Signals must satisfy for a
 * (detected, unscored) Security Opportunity to exist — deliberately
 * provisional, per the Phase 2B Step 1 brief: "Do NOT implement the final
 * security opportunity scoring model yet... Do not invent a final
 * score." This is a placeholder proving the Signal -> Opportunity path
 * exists end to end, not a judgment about which protocols are worth a
 * researcher's time.
 *
 * Phase 2B Step 1's correction: qualification is no longer "any signal at
 * all" — the live verification against the real DefiLlama feed found that
 * rule meaningless in practice, since NEW_PROTOCOL fires on literally
 * every first observation, so every tracked target became an
 * "Opportunity" regardless of whether anything substantive was found.
 * Qualification is now per-signal-type, declared once at each type's
 * registration (`SecuritySignalTypeOptions.qualifiesForOpportunity` — see
 * `registry.ts`), not decided here: a Security Target qualifies if *any*
 * of its Signals is of a type that declares itself sufficient on its
 * own. This function stays a single, unconditional check against that
 * registry — a future signal type's eligibility is a one-line
 * declaration at its own registration call, never a change here.
 *
 * A real, calibrated threshold (mirroring `meetsOpportunityThreshold` in
 * `packages/scoring`) is deferred to a later phase, once the Phase
 * 2A-proposed scoring dimensions have an actual deterministic formula
 * behind them.
 */
export function meetsSecurityOpportunityThreshold(signalTypes: readonly string[]): boolean {
  return signalTypes.some((signalType) => doesSignalTypeQualifyForOpportunity(signalType));
}

export function describeSecurityOpportunityThreshold(): string {
  return (
    "at least one Signal of a type that declares qualifiesForOpportunity: true " +
    "(see registry.ts's SecuritySignalTypeOptions) — a Phase 2B Step 1 placeholder " +
    "policy, not a scoring model. See this function's doc comment."
  );
}
