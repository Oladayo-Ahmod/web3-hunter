import { registerEventType } from "@web3-hunter/events";
import { z } from "zod";

/**
 * Intelligence Events for the Security vertical — mirrors
 * `packages/scoring/src/event-types.ts` exactly. Registered here because
 * `packages/security` is their only producer.
 *
 * `SecurityOpportunityScored` does not exist (yet): Phase 2B Step 1
 * deliberately implements only Signal -> Intelligence -> Opportunity
 * *detection*, never scoring — see `security-opportunity-detection.ts`'s
 * doc comment.
 */

export const SecuritySignalDetected = registerEventType({
  name: "SecuritySignalDetected",
  category: "intelligence",
  version: 1,
  metadataSchema: z.object({
    signalType: z.string(),
    weight: z.number().min(0).max(1),
    reasoning: z.string(),
  }),
});

export const SecurityIntelligenceUpdated = registerEventType({
  name: "SecurityIntelligenceUpdated",
  category: "intelligence",
  version: 1,
  metadataSchema: z.object({
    trend: z.enum(["insufficient-data", "increasing", "stable", "decreasing"]),
    confidence: z.number().min(0).max(1),
    signalCount: z.number().int().min(0),
  }),
});

export const SecurityOpportunityDetected = registerEventType({
  name: "SecurityOpportunityDetected",
  category: "intelligence",
  version: 1,
  metadataSchema: z.object({
    securityOpportunityId: z.string().uuid(),
    opportunityType: z.string(),
    detectionWindow: z.string(),
    reasoning: z.string(),
  }),
});
