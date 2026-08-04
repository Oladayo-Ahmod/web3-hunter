import { deriveDeterministicId } from "@web3-hunter/shared";

export interface MatchIdentity {
  userId: string;
  opportunityId: string;
}

/**
 * Derives a Match's ID deterministically from the User Profile ×
 * Opportunity pair it belongs to, mirroring `packages/scoring`'s
 * `deriveOpportunityId` — recomputing the same Match never creates a
 * duplicate row, only updates the existing one.
 */
export function deriveMatchId(identity: MatchIdentity): string {
  return deriveDeterministicId(
    `web3-hunter:matching:match:${identity.userId}:${identity.opportunityId}`,
  );
}
