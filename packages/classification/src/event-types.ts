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

/**
 * The job-granularity counterpart to `OpportunitySkillDetected`, added
 * Milestone 13 Phase 2 — a Skill classification derived from one specific
 * Job's own `JobPosted` Event, not a Company's aggregate hiring activity.
 * `externalId` (not an `opportunityId`) identifies which Job this is
 * about, since a Job has no database row of its own — see `job_skill`'s
 * doc comment.
 */
export const JobSkillDetected = registerEventType({
  name: "JobSkillDetected",
  category: "intelligence",
  version: 1,
  metadataSchema: z.object({
    companyId: z.string().uuid(),
    externalId: z.string(),
    skillId: z.string().uuid(),
    confidence: z.number().min(0).max(1),
    reasoning: z.string(),
  }),
});
