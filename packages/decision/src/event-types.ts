import { registerEventType } from "@web3-hunter/events";
import { z } from "zod";

/**
 * Decision Events (docs/EVENT_MODEL.md §Event Categories, category
 * "decision" — defined in the closed taxonomy since Milestone 1, unused
 * until this milestone). Every Recommendation lifecycle transition is
 * recorded here before the `recommendation` projection is updated, the
 * same "Event first, then projection" discipline used throughout.
 */

const recommendationLifecycleMetadataSchema = z.object({
  recommendationId: z.string().uuid(),
  matchId: z.string().uuid(),
  opportunityId: z.string().uuid(),
});

export const RecommendationCreated = registerEventType({
  name: "RecommendationCreated",
  category: "decision",
  version: 1,
  metadataSchema: recommendationLifecycleMetadataSchema.extend({
    priority: z.number().min(0).max(1),
    reasonCode: z.string(),
    reasonDetails: z.record(z.string(), z.unknown()),
    reasonVersion: z.number().int().positive(),
  }),
});

export const RecommendationDismissed = registerEventType({
  name: "RecommendationDismissed",
  category: "decision",
  version: 1,
  metadataSchema: recommendationLifecycleMetadataSchema,
});

export const RecommendationArchived = registerEventType({
  name: "RecommendationArchived",
  category: "decision",
  version: 1,
  metadataSchema: recommendationLifecycleMetadataSchema,
});

export const RecommendationRestored = registerEventType({
  name: "RecommendationRestored",
  category: "decision",
  version: 1,
  metadataSchema: recommendationLifecycleMetadataSchema,
});

export const RecommendationExpired = registerEventType({
  name: "RecommendationExpired",
  category: "decision",
  version: 1,
  metadataSchema: recommendationLifecycleMetadataSchema,
});
