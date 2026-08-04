import { registerEventType } from "@web3-hunter/events";
import { z } from "zod";

/**
 * A Skill classification derived from an Opportunity's underlying Source
 * Events. Category "intelligence": the same category
 * `HiringSignalDetected`/`OpportunityDetected`/`OpportunityScored` use, per
 * docs/ARCHITECTURE.md §4 — a derived, explainable fact about an
 * Opportunity, not a raw source fact.
 */
export const OpportunitySkillDetected = registerEventType({
  name: "OpportunitySkillDetected",
  category: "intelligence",
  version: 1,
  metadataSchema: z.object({
    opportunityId: z.string().uuid(),
    skillId: z.string().uuid(),
    confidence: z.number().min(0).max(1),
    reasoning: z.string(),
  }),
});
