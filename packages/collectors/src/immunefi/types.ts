import { z } from "zod";

/**
 * Validated, but deliberately not reshaped: `.passthrough()` preserves
 * every field Immunefi sends, even ones we don't use, so what gets
 * stored as a Raw Record is genuinely the source's native shape — same
 * discipline as `../github/types.ts`/`../defillama/types.ts`. Modeled
 * against `GET https://immunefi.com/public-api/bounties.json`, directly
 * verified live (232 programs, no authentication, every `slug` unique).
 *
 * Only the fields this Collector's normalizer actually reads are
 * declared; everything else (the extensive scope-rules prose, feature
 * flags, boosted-leaderboard data, etc.) rides through via
 * `.passthrough()`.
 */
export const immunefiAssetSchema = z
  .object({
    id: z.string(),
    url: z.string().nullable().optional(),
    type: z.string(),
    description: z.string().nullable().optional(),
  })
  .passthrough();

export const immunefiBountySchema = z
  .object({
    slug: z.string(),
    project: z.string(),
    ecosystem: z.array(z.string()).optional().default([]),
    launchDate: z.string(),
    updatedDate: z.string(),
    // ISO 8601 string, or `null`/absent for an ongoing program — see
    // `../bounty-program-events.ts`'s `endDate` doc comment. `.optional()`
    // as well as `.nullable()` so a raw payload captured before this
    // field was tracked (missing the key entirely, not just `null`)
    // normalizes identically to "no end date," never an invented one.
    endDate: z.string().nullable().optional(),
    isPaused: z.boolean(),
    pausedAt: z.string().nullable().optional(),
    maxBounty: z.number(),
    rewardsPool: z.number(),
    githubUrl: z.string().nullable().optional(),
    websiteUrl: z.string().nullable().optional(),
    kyc: z.boolean(),
    inviteOnly: z.boolean(),
    assets: z.array(immunefiAssetSchema).optional().default([]),
  })
  .passthrough();

export type ImmunefiAsset = z.infer<typeof immunefiAssetSchema>;
export type ImmunefiBounty = z.infer<typeof immunefiBountySchema>;

export const immunefiBountiesResponseSchema = z.array(immunefiBountySchema);
