import { z } from "zod";

/**
 * Validated, but deliberately not reshaped: `.passthrough()` preserves
 * every field Lever sends, even ones we don't use, so what gets stored as
 * a Raw Record is genuinely the source's native shape — see
 * docs/EVENT_MODEL.md's Raw Record definition. Modeled against Lever's
 * public Postings API (`GET /v0/postings/{site}?mode=json`) — no
 * authentication required, the same API that powers a company's own
 * `jobs.lever.co` careers page.
 */
export const leverPostingSchema = z
  .object({
    id: z.string(),
    text: z.string(),
    createdAt: z.number(),
    // Not consistently present across Lever accounts/API versions —
    // treated as optional and, when absent, `createdAt` is used instead
    // (see ./normalize.ts).
    updatedAt: z.number().optional(),
    hostedUrl: z.string(),
    categories: z
      .object({
        team: z.string().optional(),
        department: z.string().optional(),
        location: z.string().optional(),
      })
      .optional(),
  })
  .passthrough();

export type LeverPosting = z.infer<typeof leverPostingSchema>;

export const leverPostingsResponseSchema = z.array(leverPostingSchema);
