import { z } from "zod";

/**
 * Validated, but deliberately not reshaped: `.passthrough()` preserves
 * every field GitHub sends, even ones we don't use, so what gets stored
 * as a Raw Record is genuinely the source's native shape — see
 * docs/EVENT_MODEL.md's Raw Record definition. Modeled against GitHub's
 * public REST API (`GET /orgs/{org}/repos`) — no authentication required
 * for a public org's public repositories, though an optional token (see
 * ./env.ts) raises the otherwise-low unauthenticated rate limit.
 *
 * `language` is the repository's single primary language as GitHub's
 * repo-listing endpoint reports it — not the full per-language byte
 * breakdown from the separate `/languages` endpoint. A first, defensible
 * simplification for Milestone 9: it avoids an N+1 fan-out of one extra
 * API call per repository, at the cost of only ever detecting a
 * repository's dominant language, never its secondary ones.
 */
export const githubRepoSchema = z
  .object({
    id: z.number(),
    name: z.string(),
    full_name: z.string(),
    html_url: z.string(),
    description: z.string().nullable(),
    language: z.string().nullable(),
    topics: z.array(z.string()).optional().default([]),
    archived: z.boolean(),
    fork: z.boolean(),
    license: z.object({ key: z.string() }).nullable().optional(),
    stargazers_count: z.number(),
    pushed_at: z.string(),
    updated_at: z.string(),
  })
  .passthrough();

export type GithubRepo = z.infer<typeof githubRepoSchema>;

export const githubOrgReposResponseSchema = z.array(githubRepoSchema);
