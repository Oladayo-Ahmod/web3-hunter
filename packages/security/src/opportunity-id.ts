import { deriveDeterministicId } from "@web3-hunter/shared";

export interface SecurityOpportunityIdentity {
  securityTargetId: string;
  opportunityType: string;
  detectionWindow: string;
}

/**
 * Derives a stable Security Opportunity ID from stable business inputs
 * — mirrors `packages/scoring`'s `deriveOpportunityId` exactly, scoped to
 * a Security Target instead of a Company: replaying the same Event
 * history must reproduce the same Security Opportunity identity, never
 * a duplicate.
 */
export function deriveSecurityOpportunityId(identity: SecurityOpportunityIdentity): string {
  return deriveDeterministicId(
    `web3-hunter:security:opportunity:${identity.securityTargetId}:${identity.opportunityType}:${identity.detectionWindow}`,
  );
}

/**
 * The Security vertical's Opportunity Type vocabulary — named constants,
 * not a database enum, for the same reason `ENGINEERING_HIRING_SURGE` is
 * one: `security_opportunity.opportunityType` is deliberately open text
 * (see that table's doc comment), and this is the one place each type
 * name is defined so nothing retypes the raw string.
 */
export const AUDIT_CONTEST = "audit-contest";
export const BUG_BOUNTY = "bug-bounty";
export const ACTIVE_PROTOCOL = "active-protocol";
export const SHADOW_AUDIT = "shadow-audit";
export const SECURITY_RESEARCH = "security-research";
export const DISCLOSURE = "disclosure";
