/**
 * Explicit, deterministic category exclusion policy for
 * `auditCoverageGapDetector` — decided after the Phase 2B Step 1 live
 * verification against the real DefiLlama feed found the detector's
 * TVL-sorted output dominated by two categories that are not
 * smart-contract audit targets in the sense this detector means to flag:
 *
 * - `"CEX"` — a centralized exchange's DefiLlama TVL represents
 *   custodied account balances, not deployed contract code. DefiLlama's
 *   `audits: "0"` for a CEX says nothing about contract-level audit
 *   coverage, because there is usually no on-chain contract to audit in
 *   the relevant sense.
 * - `"Risk Curators"` (e.g. Gauntlet, Steakhouse Financial) — these are
 *   advisory firms that set risk parameters for *other* protocols. The
 *   firm itself is not the audit target; whichever protocol it advises
 *   is (and is tracked as its own Security Target with its own category).
 *
 * Deliberately NOT excluded: any bridge category (`"Bridge"`,
 * `"Canonical Bridge"`, `"Cross Chain Bridge"`, etc). Some of DefiLlama's
 * bridge-categorized entries are CEX-operated custodial wrappers (e.g.
 * "Coinbase Bridge," "Binance Bitcoin") and some are genuinely
 * permissionless on-chain systems (e.g. "Arbitrum Bridge," "Base
 * Bridge") — DefiLlama's `category` field alone cannot reliably
 * distinguish the two, and guessing from a protocol's *name* would be
 * exactly the kind of hardcoded, protocol-specific special case this
 * system avoids elsewhere. This is a known, documented limitation, not a
 * resolved classification: a bridge category is never excluded here
 * until a real, deterministic signal exists to tell custodial apart from
 * permissionless bridges.
 */
const AUDIT_COVERAGE_GAP_EXCLUDED_CATEGORIES: ReadonlySet<string> = new Set([
  "CEX",
  "Risk Curators",
]);

/** Whether a protocol's DefiLlama `category` is eligible to produce an AUDIT_COVERAGE_GAP Signal. A `null` category (not reported) is eligible — there is nothing to exclude it by. */
export function isCategoryEligibleForAuditCoverageGap(category: string | null): boolean {
  return category === null || !AUDIT_COVERAGE_GAP_EXCLUDED_CATEGORIES.has(category);
}
