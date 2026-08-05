import { getGithubCollectorEnv } from "./env";
import { githubOrgReposResponseSchema, type GithubRepo } from "./types";

const GITHUB_API_BASE = "https://api.github.com/orgs";

/**
 * Fetches a GitHub organization's public, non-forked repositories — no
 * authentication required. This is the entire extent of this Collector's
 * job: fetch and validate the shape, nothing more — the same discipline
 * every other Collector's fetch function follows. `GITHUB_TOKEN` (see
 * ./env.ts), when configured, is sent as a bearer token purely to raise
 * the rate limit; its absence is not an error.
 */
export async function fetchGithubOrgRepos(org: string): Promise<GithubRepo[]> {
  const env = getGithubCollectorEnv();
  const headers: Record<string, string> = { Accept: "application/vnd.github+json" };
  if (env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${env.GITHUB_TOKEN}`;
  }

  const response = await fetch(`${GITHUB_API_BASE}/${org}/repos?type=public&per_page=100`, {
    headers,
  });

  if (!response.ok) {
    throw new Error(
      `GitHub API request failed for org "${org}": ${response.status} ${response.statusText}`,
    );
  }

  const body: unknown = await response.json();
  return githubOrgReposResponseSchema.parse(body);
}
