import { registerEventType } from "@web3-hunter/events";
import { z } from "zod";

/**
 * A Match computation between a User Profile and an Opportunity.
 * Category "user": this is fundamentally User-scoped data (see
 * `relatedEntityType` on the published Event), distinct from the
 * Company/Opportunity-scoped "intelligence" category `packages/scoring`
 * and `packages/classification` use.
 */
export const MatchComputed = registerEventType({
  name: "MatchComputed",
  category: "user",
  version: 1,
  metadataSchema: z.object({
    opportunityId: z.string().uuid(),
    score: z.number().min(0).max(1),
    reasoning: z.string(),
    matchedSkillIds: z.array(z.string().uuid()),
    // Milestone 9's technology-fit component. Additive per
    // docs/EVENT_MODEL.md §Event Versioning ("additive changes do not
    // require a new version") — optional so metadata from any hypothetical
    // pre-Milestone-9 event (none exist in practice, since replay never
    // re-validates stored metadata against the current schema) would still
    // parse.
    matchedTechnologySkillIds: z.array(z.string().uuid()).optional().default([]),
  }),
});
