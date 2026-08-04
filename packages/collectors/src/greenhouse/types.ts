import { z } from "zod";

/**
 * Validated, but deliberately not reshaped: `.passthrough()` preserves
 * every field Greenhouse sends, even ones we don't use, so what gets
 * stored as a Raw Record is genuinely the source's native shape — see
 * docs/EVENT_MODEL.md's Raw Record definition.
 */
export const greenhouseJobSchema = z
  .object({
    id: z.number(),
    title: z.string(),
    updated_at: z.string(),
    absolute_url: z.string(),
    location: z.object({ name: z.string() }).nullable().optional(),
    departments: z.array(z.object({ name: z.string() })).optional(),
  })
  .passthrough();

export type GreenhouseJob = z.infer<typeof greenhouseJobSchema>;

export const greenhouseBoardResponseSchema = z.object({
  jobs: z.array(greenhouseJobSchema),
});
