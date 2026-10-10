import { getDb, schema } from "@web3-hunter/db";
import { extractGithubOwner, normalizeRepositoryUrl } from "./security-target-store";

/**
 * Discovery-time evidence classes — these describe what the available
 * identity evidence *looks like under this tool's comparison rules*,
 * never a decision about the real-world protocols. In particular:
 * - `"conflict"` means the supplied repository evidence disagrees under
 *   this tool's explicit comparison rules. It is NOT proof that the two
 *   Security Targets represent different real-world protocols — forks,
 *   migrations, and multi-repository projects exist, and none of those
 *   are ruled out by a repository-URL mismatch alone.
 * - `"high-confidence"` means strong, independently available evidence
 *   supports a *possible* match — never automatic reconciliation.
 * This tool only ever reads; nothing it produces authorizes a merge.
 */
export type SecurityTargetIdentityCandidateClassification =
  "high-confidence" | "candidate-only" | "conflict" | "insufficient-evidence";

export interface SecurityTargetIdentitySnapshot {
  id: string;
  slug: string;
  name: string;
  repositoryUrl: string | null;
}

export interface SecurityTargetIdentityCandidate {
  targetA: { id: string; slug: string };
  targetB: { id: string; slug: string };
  classification: SecurityTargetIdentityCandidateClassification;
  /** Human-readable, exact facts the classification was based on — never a claim stronger than what was actually compared. */
  evidence: string[];
  /** True when a name/slug similarity hint contributed to this pair being *generated* at all — it never raises `classification` above what the repository-URL evidence alone would support. */
  generatedByNameSimilarityHint: boolean;
}

/**
 * Whether a `github.com/...` URL actually names a specific repository
 * (owner **and** a repo segment), as opposed to an organization-only
 * URL (owner alone). Deliberately separate from `extractGithubOwner`
 * (which only ever returns the owner) so an org-only URL can never be
 * mistaken for a full repository-path match merely because two org-only
 * strings happen to be textually identical.
 */
function hasGithubRepoPath(url: string): boolean {
  return /github\.com\/[^/\s]+\/[^/\s]+/i.test(url);
}

function normalizeForSimilarity(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Standard Levenshtein edit distance — small, pure, dependency-free; only ever called on short slug/name strings for a cheap similarity hint. */
function levenshteinDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const distances: number[][] = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));

  for (let i = 0; i < rows; i++) distances[i]![0] = i;
  for (let j = 0; j < cols; j++) distances[0]![j] = j;

  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      distances[i]![j] = Math.min(
        distances[i - 1]![j]! + 1,
        distances[i]![j - 1]! + 1,
        distances[i - 1]![j - 1]! + cost,
      );
    }
  }

  return distances[rows - 1]![cols - 1]!;
}

/**
 * An optional, deliberately weak signal that a pair is worth *looking
 * at* — never evidence of identity on its own (per this tool's explicit
 * brief: "never as proof of identity"). Used only to decide whether a
 * pair with no repository-URL evidence at all still gets surfaced,
 * always as `"insufficient-evidence"`.
 */
function hasNameSimilarityHint(
  a: SecurityTargetIdentitySnapshot,
  b: SecurityTargetIdentitySnapshot,
): boolean {
  const nameA = normalizeForSimilarity(a.name);
  const nameB = normalizeForSimilarity(b.name);
  if (nameA.length > 0 && nameA === nameB) {
    return true;
  }

  const slugA = normalizeForSimilarity(a.slug);
  const slugB = normalizeForSimilarity(b.slug);
  if (slugA.length >= 4 && slugB.length >= 4 && (slugA.includes(slugB) || slugB.includes(slugA))) {
    return true;
  }
  if (slugA.length > 0 && slugB.length > 0 && levenshteinDistance(slugA, slugB) <= 2) {
    return true;
  }

  return false;
}

function classifyPair(
  a: SecurityTargetIdentitySnapshot,
  b: SecurityTargetIdentitySnapshot,
): {
  classification: SecurityTargetIdentityCandidateClassification;
  evidence: string[];
  generatedByNameSimilarityHint: boolean;
} | null {
  if (a.repositoryUrl && b.repositoryUrl) {
    const ownerA = extractGithubOwner(a.repositoryUrl);
    const ownerB = extractGithubOwner(b.repositoryUrl);

    if (ownerA && ownerB) {
      if (ownerA !== ownerB) {
        return {
          classification: "conflict",
          evidence: [
            `different GitHub organizations under this tool's comparison rule: "${ownerA}" vs "${ownerB}"`,
          ],
          generatedByNameSimilarityHint: false,
        };
      }

      const hasPathA = hasGithubRepoPath(a.repositoryUrl);
      const hasPathB = hasGithubRepoPath(b.repositoryUrl);
      if (
        hasPathA &&
        hasPathB &&
        normalizeRepositoryUrl(a.repositoryUrl) === normalizeRepositoryUrl(b.repositoryUrl)
      ) {
        return {
          classification: "high-confidence",
          evidence: [`exact repository path match (github.com/${ownerA}/...)`],
          generatedByNameSimilarityHint: false,
        };
      }

      return {
        classification: "candidate-only",
        evidence: [
          `shared GitHub organization only ("${ownerA}") — ` +
            (hasPathA && hasPathB
              ? "different repository paths under that organization"
              : "at least one side is an organization-only URL, not a specific repository") +
            "; a shared organization can host multiple unrelated protocols",
        ],
        generatedByNameSimilarityHint: false,
      };
    }

    if (!ownerA && !ownerB) {
      if (normalizeRepositoryUrl(a.repositoryUrl) === normalizeRepositoryUrl(b.repositoryUrl)) {
        return {
          classification: "high-confidence",
          evidence: ["exact repository URL match"],
          generatedByNameSimilarityHint: false,
        };
      }
      return {
        classification: "conflict",
        evidence: [
          `differing repository URLs under this tool's comparison rule: "${a.repositoryUrl}" vs "${b.repositoryUrl}"`,
        ],
        generatedByNameSimilarityHint: false,
      };
    }

    return {
      classification: "insufficient-evidence",
      evidence: ["repository URLs present on both sides but not in directly comparable formats"],
      generatedByNameSimilarityHint: false,
    };
  }

  if (hasNameSimilarityHint(a, b)) {
    return {
      classification: "insufficient-evidence",
      evidence: [
        "slug/name similarity only — no independent repository-URL evidence on at least one side",
      ],
      generatedByNameSimilarityHint: true,
    };
  }

  return null;
}

/**
 * Pure, read-only classification over an already-fetched snapshot — no
 * database access, so this is directly unit-testable with plain
 * fixtures and no disposable database. Compares every pair of targets
 * with *different* slugs (same-slug duplicates cannot exist: `slug` is
 * a DB-level unique constraint) in O(n^2) pairwise comparisons —
 * acceptable for this tool's current, small target count, but not
 * intended to scale to an arbitrarily large dataset without a
 * narrowing pre-filter.
 *
 * Output is sorted by `(targetA.slug, targetB.slug)` for deterministic,
 * stable ordering across runs against the same input.
 */
export function classifySecurityTargetIdentityCandidates(
  targets: SecurityTargetIdentitySnapshot[],
): SecurityTargetIdentityCandidate[] {
  const sorted = [...targets].sort((x, y) => x.slug.localeCompare(y.slug));
  const candidates: SecurityTargetIdentityCandidate[] = [];

  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const a = sorted[i]!;
      const b = sorted[j]!;
      if (a.slug === b.slug) {
        // Defensive only — `security_target.slug` is a DB-level unique
        // constraint, so this branch is unreachable against real data.
        continue;
      }

      const result = classifyPair(a, b);
      if (!result) {
        continue;
      }

      candidates.push({
        targetA: { id: a.id, slug: a.slug },
        targetB: { id: b.id, slug: b.slug },
        classification: result.classification,
        evidence: result.evidence,
        generatedByNameSimilarityHint: result.generatedByNameSimilarityHint,
      });
    }
  }

  return candidates;
}

export interface SecurityTargetIdentityDiscoveryResult {
  targetsInspected: number;
  pairwiseComparisons: number;
  candidates: SecurityTargetIdentityCandidate[];
}

/**
 * The only database-touching function in this module — one read-only
 * `SELECT` of every Security Target's `id`/`slug`/`name`/`repositoryUrl`,
 * then delegates entirely to the pure classifier above. Never inserts,
 * updates, or deletes anything, and never invokes any collector,
 * scoring, or reconciliation function.
 */
export async function discoverSecurityTargetIdentityCandidates(): Promise<SecurityTargetIdentityDiscoveryResult> {
  const rows = await getDb()
    .select({
      id: schema.securityTarget.id,
      slug: schema.securityTarget.slug,
      name: schema.securityTarget.name,
      repositoryUrl: schema.securityTarget.repositoryUrl,
    })
    .from(schema.securityTarget);

  const candidates = classifySecurityTargetIdentityCandidates(rows);

  return {
    targetsInspected: rows.length,
    pairwiseComparisons: (rows.length * (rows.length - 1)) / 2,
    candidates,
  };
}
