import {
  doesSignalTypeNameSpecificArtifact,
  doesSignalTypeQualifyForOpportunity,
} from "@web3-hunter/security";

/**
 * Deterministic, explainable Security Target prioritization (the approved
 * Security Research Prioritization design) — the Security vertical's
 * counterpart to `job-relevance.ts`'s `tierForScore`, but ordinal rather
 * than numeric: there is no validated basis yet for weighting one
 * qualifying Security Signal against another, so this derives a tier from
 * which *kind* of evidence exists, not from a score.
 *
 * Pure and synchronous — every I/O concern (which Signals a Security
 * Target has, counting distinct triggering Events) belongs to
 * `security-target-query-service.ts`, which composes the reads and calls
 * this module with plain data.
 */

export const SECURITY_TARGET_PRIORITY_TIERS = ["A", "B", "C"] as const;
export type SecurityTargetPriorityTier = (typeof SECURITY_TARGET_PRIORITY_TIERS)[number];

export interface SecurityTargetTierResult {
  tier: SecurityTargetPriorityTier;
  reason: string;
  /** Distinct, sorted qualifying Signal types this result was derived from — empty for Tier C. The single source of truth for "which types qualified," so a caller never re-filters with its own copy of this logic. */
  qualifyingSignalTypes: string[];
}

/**
 * Tier rule (per the approved design):
 * - A: at least one qualifying Signal whose type names a specific
 *   artifact (e.g. a particular added bounty-scope asset) — see
 *   `@web3-hunter/security`'s `SecuritySignalTypeOptions.namesSpecificArtifact`.
 * - B: at least one qualifying Signal, but none meeting A — e.g. a TVL
 *   figure or an asset *count*, never a specific artifact to go look at.
 * - C: no qualifying Signal at all. A real, legitimate result — a
 *   discovered Security Target with no Opportunity yet, not an error or
 *   an omission.
 *
 * Takes every observed Signal type for a target (qualifying or not) and
 * filters internally, so "a non-qualifying Signal type is present" can
 * never itself elevate the tier — the same discipline
 * `doesSignalTypeQualifyForOpportunity` already enforces for Opportunity
 * detection. Signal types are deduplicated and sorted before inspection so
 * the result never depends on the order Signals were read from storage.
 */
export function securityTargetPriorityTier(
  signalTypes: readonly string[],
): SecurityTargetTierResult {
  const distinctSorted = [...new Set(signalTypes)].sort();
  const qualifying = distinctSorted.filter((type) => doesSignalTypeQualifyForOpportunity(type));

  if (qualifying.length === 0) {
    return {
      tier: "C",
      reason: "No detected Security Signal qualifies this target for an Opportunity yet.",
      qualifyingSignalTypes: [],
    };
  }

  const artifactNamingType = qualifying.find((type) => doesSignalTypeNameSpecificArtifact(type));
  if (artifactNamingType) {
    return {
      tier: "A",
      reason: `A qualifying signal ("${artifactNamingType}") names a specific artifact to review.`,
      qualifyingSignalTypes: qualifying,
    };
  }

  return {
    tier: "B",
    reason:
      `A qualifying signal exists (${qualifying.join(", ")}), but none of them name a specific ` +
      "artifact — only a count or an aggregate figure.",
    qualifyingSignalTypes: qualifying,
  };
}

/**
 * Evidence confidence, per the approved design: the number of *distinct*
 * triggering Events behind a target's Signals, not the number of Signal
 * rows. Multiple Signal types can share one triggering Event (e.g. one
 * DefiLlama poll producing both a `new-protocol` and an
 * `audit-coverage-gap` Signal) — that is one independent observation, not
 * two, and must count as one here.
 */
export function countDistinctTriggeringEvents(
  signals: readonly { sourceEventIds: readonly string[] }[],
): number {
  const eventIds = new Set<string>();
  for (const signal of signals) {
    for (const eventId of signal.sourceEventIds) {
      eventIds.add(eventId);
    }
  }
  return eventIds.size;
}

export const SECURITY_TARGET_RESEARCH_READINESS_STATUSES = [
  "ready",
  "insufficient-evidence",
  "no-current-route",
] as const;
export type SecurityTargetResearchReadinessStatus =
  (typeof SECURITY_TARGET_RESEARCH_READINESS_STATUSES)[number];

export interface SecurityTargetResearchReadinessResult {
  status: SecurityTargetResearchReadinessStatus;
  reason: string;
  /** A concrete next step, grounded only in already-known scope/asset counts — never fabricated (no invented asset names, addresses, or audit conclusions). `null` whenever `status !== "ready"`. */
  nextAction: string | null;
}

export interface SecurityTargetResearchReadinessInput {
  /** The existing, unmodified `actionability.isActionable` — never recomputed here. */
  isActionable: boolean;
  /** The number of smart-contract assets the active bounty currently lists — only meaningful when `isActionable`; ignored otherwise. */
  actionableAssetCount: number;
  /** The same qualifying Signal types `securityTargetPriorityTier` already derived — not re-filtered or reinterpreted. */
  qualifyingSignalTypes: readonly string[];
}

/**
 * Research readiness — a third, independent dimension alongside `tier`
 * (what changed, historically) and `actionability` (is there a verified,
 * live route right now). Neither of those two answers "is this worth a
 * researcher's time today": `tier` can be high from a stale, one-time
 * signal with no current bounty at all, and `actionability` says nothing
 * about a target with real signal history but a currently paused program.
 * This function conflates neither — it only combines the two existing,
 * unmodified results into one of three honest states.
 *
 * - `"ready"`: `isActionable` alone is sufficient — a qualifying Signal is
 *   never required. A live, non-expired bounty with real scope is a
 *   verified route on its own.
 * - `"insufficient-evidence"`: no verified current route, but a
 *   qualifying Signal is a real, concrete lead (it names a specific kind
 *   of change — see `doesSignalTypeQualifyForOpportunity`) worth
 *   following up, even without a currently live bounty. Repository or
 *   audit evidence alone, or a *non*-qualifying Signal, never reaches
 *   this status on their own — they describe the target, they are not
 *   themselves an investigative lead.
 * - `"no-current-route"`: neither of the above. A legitimate, expected
 *   result for a freshly discovered target — never a claim that the
 *   target is insecure, uninteresting, or unresearchable; only that
 *   nothing in the current model yet verifies a concrete route.
 */
export function deriveResearchReadiness(
  input: SecurityTargetResearchReadinessInput,
): SecurityTargetResearchReadinessResult {
  if (input.isActionable) {
    return {
      status: "ready",
      reason:
        "An active, non-expired bounty program currently lists concrete smart-contract scope.",
      nextAction:
        `Review the ${input.actionableAssetCount} smart-contract asset(s) currently in scope ` +
        "under the active bounty program.",
    };
  }

  const qualifying = [...input.qualifyingSignalTypes].sort();
  if (qualifying.length > 0) {
    return {
      status: "insufficient-evidence",
      reason:
        `A qualifying Security Signal ("${qualifying[0]}") was detected, but no active, ` +
        "non-expired bounty program with in-scope assets is currently verified — this is a " +
        "lead worth investigating, not a verified current route.",
      nextAction: null,
    };
  }

  return {
    status: "no-current-route",
    reason:
      "No qualifying Security Signal has been detected, and no active, non-expired bounty " +
      "program with in-scope assets is currently verified. This does not mean the target is " +
      "insecure or that research here is impossible — only that no current, evidence-backed " +
      "route is established yet.",
    nextAction: null,
  };
}
