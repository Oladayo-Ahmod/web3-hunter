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
  }),
});
