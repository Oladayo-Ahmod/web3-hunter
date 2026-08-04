import { MAX_DIGEST_CANDIDATES } from "./constants";

/** The minimal shape `selectDigestCandidates` needs — Recommendation-scoped, per the Milestone 6 refinement (never Match-scoped). */
export interface DigestCandidateInput {
  id: string;
  status: "active" | "dismissed" | "archived" | "expired";
  priority: number;
}

/**
 * Selects which of a User's Recommendations belong in a digest — a pure,
 * deterministic function returning a value, not a persisted Digest
 * entity or delivery mechanism (both are out of scope for this
 * milestone; see the Definition of Ready). Operates on Recommendations,
 * never on Matches directly, per the Milestone 6 refinement.
 */
export function selectDigestCandidates<T extends DigestCandidateInput>(
  recommendations: readonly T[],
): T[] {
  return recommendations
    .filter((recommendation) => recommendation.status === "active")
    .sort((a, b) => b.priority - a.priority)
    .slice(0, MAX_DIGEST_CANDIDATES);
}
