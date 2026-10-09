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
