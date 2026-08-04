import { deriveDeterministicId } from "@web3-hunter/shared";

export interface OpportunityIdentity {
  companyId: string;
  opportunityType: string;
  detectionWindow: string;
}

/**
 * Derives a stable Opportunity ID from stable business inputs — Company,
 * Opportunity Type, and Detection Window — rather than generating a
 * random one, per the approved Milestone 3 refinement: replaying the same
 * Event history must produce the same Opportunity identity, not a
 * duplicate, so ongoing hiring activity within the same window updates
 * one Opportunity rather than creating a new one for every contributing
 * Signal.
 */
export function deriveOpportunityId(identity: OpportunityIdentity): string {
  return deriveDeterministicId(
    `web3-hunter:scoring:opportunity:${identity.companyId}:${identity.opportunityType}:${identity.detectionWindow}`,
  );
}

/**
 * The single Opportunity Type this milestone's detection rules produce.
 * Registered as a named constant (not a scattered string literal)
 * precisely so a future milestone introducing a second type has one
 * obvious place to add it — see docs/ROADMAP.md Milestone 3.
 */
export const ENGINEERING_HIRING_SURGE = "engineering-hiring-surge";
