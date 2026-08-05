import { createEnv } from "@web3-hunter/shared";
import { z } from "zod";

/**
 * `GITHUB_TOKEN` is optional — the GitHub REST API serves a public org's
 * public repositories unauthenticated. A token only raises the rate limit
 * (60 requests/hour unauthenticated vs. 5,000/hour authenticated); nothing
 * in this package is load-bearing on it, the same "optional, never
 * throws" discipline `packages/ai`'s env module uses.
 */
const schema = z.object({
  GITHUB_TOKEN: z.string().min(1).optional(),
});

export type GithubCollectorEnv = z.infer<typeof schema>;

let cached: GithubCollectorEnv | undefined;

export function getGithubCollectorEnv(): GithubCollectorEnv {
  cached ??= createEnv(schema);
  return cached;
}

/** Test-only: clears the memoized environment so a test can reconfigure `process.env` and re-resolve. */
export function resetGithubCollectorEnvCache(): void {
  cached = undefined;
}
