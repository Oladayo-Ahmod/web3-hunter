import { registerEventType } from "@web3-hunter/events";
import { z } from "zod";

/**
 * AI Enrichment Events. Per the Milestone 7 refinement, these do not get
 * their own event category — the category taxonomy represents
 * business-domain lifecycle, not which package produced the event, the
 * same way multiple Collectors all publish "source" events.
 * `packages/ai` maps into the existing categories by what each artifact
 * is *about*:
 *
 * - AIRecommendationGenerated  → "recommendation" (about a Recommendation)
 * - OpportunitySummaryGenerated → "intelligence" (about an Opportunity)
 * - CompanySummaryGenerated     → "intelligence" (about a Company)
 * - ProfileInsightGenerated     → "user" (about a User Profile)
 * - OutreachDraftGenerated      → "decision" (about what to do next)
 *
 * These events record enrichment only — they never assert a business
 * fact, and nothing in `packages/scoring`, `packages/matching`, or
 * `packages/decision` ever consumes them.
 */

const baseArtifactMetadataSchema = z.object({
  artifactId: z.string().uuid(),
  version: z.number().int().positive(),
  promptVersion: z.number().int().positive(),
  provider: z.string().min(1),
  model: z.string().min(1),
});

export const AIRecommendationGenerated = registerEventType({
  name: "AIRecommendationGenerated",
  category: "recommendation",
  version: 1,
  metadataSchema: baseArtifactMetadataSchema.extend({
    recommendationId: z.string().uuid(),
  }),
});

export const OpportunitySummaryGenerated = registerEventType({
  name: "OpportunitySummaryGenerated",
  category: "intelligence",
  version: 1,
  metadataSchema: baseArtifactMetadataSchema.extend({
    opportunityId: z.string().uuid(),
  }),
});

export const CompanySummaryGenerated = registerEventType({
  name: "CompanySummaryGenerated",
  category: "intelligence",
  version: 1,
  metadataSchema: baseArtifactMetadataSchema.extend({
    companyId: z.string().uuid(),
  }),
});

export const ProfileInsightGenerated = registerEventType({
  name: "ProfileInsightGenerated",
  category: "user",
  version: 1,
  metadataSchema: baseArtifactMetadataSchema.extend({
    userId: z.string(),
  }),
});

export const OutreachDraftGenerated = registerEventType({
  name: "OutreachDraftGenerated",
  category: "decision",
  version: 1,
  metadataSchema: baseArtifactMetadataSchema.extend({
    recommendationId: z.string().uuid(),
  }),
});
