import type { Normalizer } from "@web3-hunter/ingestion";
import { z } from "zod";
import { getGithubCollectorEnv } from "../github/env";
import {
  createSecurityDisclosureRouteNormalizer,
  type CanonicalSecurityDisclosureRoute,
} from "../security-disclosure-events";
import { readTextWithLimit } from "./url-safety";

const GITHUB_API_BASE = "https://api.github.com/repos";
const FETCH_TIMEOUT_MS = 5_000;
/** GitHub's Community Profile response is a small, fixed-shape JSON document — bounds memory against an unexpected response. */
const MAX_RESPONSE_BYTES = 100 * 1024;
/** GitHub's own login/repo-name character rules — see https://docs.github.com/en/repositories/creating-and-managing-repositories/repository-name — rejecting anything else here means `owner`/`repo` can never carry path-traversal or header-injection characters into the fetched URL, whatever their original source. */
const GITHUB_NAME_PATTERN = /^[A-Za-z0-9._-]+$/;

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
  if (!GITHUB_NAME_PATTERN.test(owner) || !GITHUB_NAME_PATTERN.test(repo)) {
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
  if (!GITHUB_NAME_PATTERN.test(owner) || !GITHUB_NAME_PATTERN.test(repo)) {
    throw new Error(
      `GitHub community profile request refused: invalid owner/repo "${owner}/${repo}"`,
    );
  }

  const env = getGithubCollectorEnv();
  const headers: Record<string, string> = { Accept: "application/vnd.github+json" };
  if (env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${env.GITHUB_TOKEN}`;
  }

  const sourceUrl = `${GITHUB_API_BASE}/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/community/profile`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(sourceUrl, { headers, signal: controller.signal });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`GitHub community profile request failed for "${owner}/${repo}": ${reason}`);
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    throw new Error(
      `GitHub community profile request failed for "${owner}/${repo}": ${response.status} ${response.statusText}`,
    );
  }

  const text = await readTextWithLimit(response, MAX_RESPONSE_BYTES, "GitHub community profile");
  const parsed = githubCommunityProfileSchema.parse(JSON.parse(text));
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
