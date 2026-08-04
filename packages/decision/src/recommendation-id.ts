import { deriveDeterministicId } from "@web3-hunter/shared";

/**
 * Derives a Recommendation's ID deterministically from the Match it
 * belongs to — a Match has at most one Recommendation
 * (docs/DOMAIN_MODEL.md §Match), so recomputing eligibility for the same
 * Match never creates a duplicate row, only updates the existing one.
 */
export function deriveRecommendationId(matchId: string): string {
  return deriveDeterministicId(`web3-hunter:decision:recommendation:${matchId}`);
}
