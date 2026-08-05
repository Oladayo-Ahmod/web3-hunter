import { z } from "zod";

/**
 * Validated, but deliberately not reshaped: `.passthrough()` preserves
 * every field Ashby sends, even ones we don't use, so what gets stored as
 * a Raw Record is genuinely the source's native shape — see
 * docs/EVENT_MODEL.md's Raw Record definition. Modeled against Ashby's
 * public Job Board API (`GET /posting-api/job-board/{boardName}`) — no
 * authentication required, the same API that powers a company's own
 * `jobs.ashbyhq.com` careers page.
 */
export const ashbyJobSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    department: z.string().nullable().optional(),
    team: z.string().nullable().optional(),
    location: z.string().nullable().optional(),
    publishedAt: z.string(),
    // Not consistently present — treated as optional and, when absent,
    // `publishedAt` is used instead (see ./normalize.ts).
    updatedAt: z.string().optional(),
    jobUrl: z.string(),
  })
  .passthrough();

export type AshbyJob = z.infer<typeof ashbyJobSchema>;

export const ashbyJobBoardResponseSchema = z.object({
  jobs: z.array(ashbyJobSchema),
});
