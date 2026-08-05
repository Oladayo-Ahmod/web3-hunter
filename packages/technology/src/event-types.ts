import { registerEventType } from "@web3-hunter/events";
import { z } from "zod";

/**
 * A Technology detection derived from a Company's underlying GitHub
 * Source Events. Category "intelligence" — the same category
 * `HiringSignalDetected`/`OpportunitySkillDetected` use, per
 * docs/ARCHITECTURE.md §4: a derived, explainable fact about a Company,
 * not a raw source fact. Deliberately its own event type rather than
 * reusing `OpportunitySkillDetected` — that event is Opportunity-scoped
 * (job-posting evidence); this one is Company-scoped (GitHub evidence),
 * mirroring the same Signal/Opportunity-Skill split `packages/scoring`
 * and `packages/classification` already keep separate.
 */
export const TechnologyDetected = registerEventType({
  name: "TechnologyDetected",
  category: "intelligence",
  version: 1,
  metadataSchema: z.object({
    companyId: z.string().uuid(),
    skillId: z.string().uuid(),
    confidence: z.number().min(0).max(1),
    reasoning: z.string(),
  }),
});
