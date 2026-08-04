import {
  FRESHNESS_WINDOW_DAYS,
  PRIORITY_AGE_DECAY_PER_DAY,
  PRIORITY_WEIGHT_INTELLIGENCE_CONFIDENCE,
  PRIORITY_WEIGHT_MATCH_SCORE,
  PRIORITY_WEIGHT_FRESHNESS,
} from "./constants";
import type { PriorityInputs } from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function daysBetween(earlier: Date, later: Date): number {
  return (later.getTime() - earlier.getTime()) / DAY_MS;
}

/**
 * Computes a Recommendation's priority — deterministically derived from
 * Match score, Company Intelligence confidence, Opportunity/Intelligence
 * freshness, and Recommendation age, per the Milestone 6 refinement:
 * "Match owns score; Decision owns priority." Pure and deterministic: the
 * same inputs and the same `asOf` always produce the same priority.
 *
 * A weighted blend of relevance and confidence, scaled by how fresh the
 * Intelligence behind it still is, then decayed by how long this
 * Recommendation has existed without being acted on — so an old,
 * unaddressed Recommendation naturally sinks in ranking even before it
 * hits `STALE_EXPIRATION_DAYS`'s hard cutoff. A first, defensible
 * formula, not a calibrated model — see docs/ROADMAP.md Milestone 3's
 * equivalent note for Scoring Engine v1.
 */
export function computePriority(inputs: PriorityInputs): number {
  const freshnessDays = daysBetween(inputs.intelligenceAsOf, inputs.asOf);
  const freshness = clamp01(1 - freshnessDays / FRESHNESS_WINDOW_DAYS);

  const base =
    inputs.matchScore * PRIORITY_WEIGHT_MATCH_SCORE +
    inputs.intelligenceConfidence * PRIORITY_WEIGHT_INTELLIGENCE_CONFIDENCE +
    freshness * PRIORITY_WEIGHT_FRESHNESS;

  const ageDays = daysBetween(inputs.recommendationCreatedAt, inputs.asOf);
  const ageDecay = clamp01(ageDays * PRIORITY_AGE_DECAY_PER_DAY);

  return roundTo(clamp01(base) * (1 - ageDecay), 4);
}
