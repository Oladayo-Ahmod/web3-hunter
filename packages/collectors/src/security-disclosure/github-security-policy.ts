import type { Normalizer } from "@web3-hunter/ingestion";
import { z } from "zod";
import { getGithubCollectorEnv } from "../github/env";
import {
  createSecurityDisclosureRouteNormalizer,
  type CanonicalSecurityDisclosureRoute,
} from "../security-disclosure-events";

const GITHUB_API_BASE = "https://api.github.com/repos";

const githubCommunityProfileSchema = z
  .object({
    files: z
      .object({
        // `null` is GitHub's own representation of "this file doesn't
        // exist in the repository" — not an error, not "unchecked."
        security_policy: z.object({ html_url: z.string().nullable() }).nullable().optional(),
      })
      .passthrough(),
  })
  .passthrough();

export interface GithubSecurityPolicyFetchResult {
  /** Whether this repository has a `SECURITY.md` (in any of GitHub's recognized locations) that GitHub's own Community Profile check found. */
  found: boolean;
  /** The exact GitHub API URL fetched. */
  sourceUrl: string;
  /** The file's own page on github.com, as GitHub reports it — `null` when `found` is `false`. */
  policyUrl: string | null;
}

/**
 * Extracts `{ owner, repo }` from a GitHub repository URL in any of its
 * common forms (`https://github.com/owner/repo`, with or without a
 * trailing slash or `.git`) — `null` for anything else, including a
 * GitHub *organization* URL (`github.com/owner` alone) and non-GitHub
 * URLs, since neither names a specific repository to check.
 */
export function parseGithubRepoUrl(url: string): { owner: string; repo: string } | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  if (parsed.hostname !== "github.com" && parsed.hostname !== "www.github.com") {
    return null;
  }

  const segments = parsed.pathname.split("/").filter((segment) => segment.length > 0);
  if (segments.length < 2) {
    return null;
  }

  const [owner, rawRepo] = segments;
  const repo = rawRepo!.replace(/\.git$/, "");
  if (!owner || !repo) {
    return null;
  }

  return { owner, repo };
}

/**
 * Fetches whether a public GitHub repository has a published
 * `SECURITY.md`, via GitHub's own Community Profile check — the same
 * authoritative source github.com's own "Insights → Community" tab
 * reads, rather than guessing at file paths ourselves. One bounded
 * request per repository, reusing `GITHUB_TOKEN` exactly as
 * `github/fetch.ts`'s `fetchGithubOrgRepos` does (optional, raises the
 * rate limit only).
 */
export async function fetchGithubSecurityPolicy(
  owner: string,
  repo: string,
): Promise<GithubSecurityPolicyFetchResult> {
  const env = getGithubCollectorEnv();
  const headers: Record<string, string> = { Accept: "application/vnd.github+json" };
  if (env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${env.GITHUB_TOKEN}`;
  }

  const sourceUrl = `${GITHUB_API_BASE}/${owner}/${repo}/community/profile`;
  const response = await fetch(sourceUrl, { headers });

  if (!response.ok) {
    throw new Error(
      `GitHub community profile request failed for "${owner}/${repo}": ${response.status} ${response.statusText}`,
    );
  }

  const body: unknown = await response.json();
  const parsed = githubCommunityProfileSchema.parse(body);
  const policyUrl = parsed.files.security_policy?.html_url ?? null;

  return { found: policyUrl !== null, sourceUrl, policyUrl };
}

function toCanonicalGithubSecurityPolicy(payload: unknown): CanonicalSecurityDisclosureRoute {
  const result = payload as GithubSecurityPolicyFetchResult;
  return {
    fields: {
      routeType: "github-security-policy",
      found: result.found,
      sourceUrl: result.sourceUrl,
      // No equivalent of security.txt's Contact/Canonical/Expires fields
      // in GitHub's Community Profile response.
      contacts: [],
      policyUrl: result.policyUrl,
      canonicalUrl: null,
      expires: null,
    },
    occurredAt: new Date(),
  };
}

/**
 * Builds this Collector's normalizer for one Security Target's GitHub
 * Community Profile check — mirrors `./security-txt.ts`'s
 * `createSecurityTxtNormalizer` for the other route type.
 */
export function createGithubSecurityPolicyNormalizer(securityTargetId: string): Normalizer {
  return createSecurityDisclosureRouteNormalizer(securityTargetId, toCanonicalGithubSecurityPolicy);
}
