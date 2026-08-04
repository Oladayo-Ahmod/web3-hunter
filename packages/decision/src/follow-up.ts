import { FOLLOW_UP_INTERVAL_DAYS } from "./constants";
import type { RecommendationStatus } from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;

/** The minimal shape `evaluateFollowUpSchedule` needs — Recommendation-scoped, per the Milestone 6 refinement (never Match-scoped). */
export interface FollowUpScheduleInput {
  status: RecommendationStatus;
  createdAt: Date;
}

export interface FollowUpDecision {
  recommended: boolean;
  suggestedAt: Date | null;
  reasonCode: "recommendation-not-active" | "not-yet-due" | "follow-up-interval-elapsed";
}

/**
 * Decides whether a follow-up touchpoint is warranted for a
 * Recommendation — a pure, deterministic function returning a value, not
 * a persisted Follow-up entity (out of scope for this milestone; see the
 * Definition of Ready). Operates on a Recommendation, never a Match
 * directly, per the Milestone 6 refinement.
 */
export function evaluateFollowUpSchedule(
  recommendation: FollowUpScheduleInput,
  asOf: Date,
): FollowUpDecision {
  if (recommendation.status !== "active") {
    return { recommended: false, suggestedAt: null, reasonCode: "recommendation-not-active" };
  }

  const ageDays = (asOf.getTime() - recommendation.createdAt.getTime()) / DAY_MS;
  if (ageDays < FOLLOW_UP_INTERVAL_DAYS) {
    return { recommended: false, suggestedAt: null, reasonCode: "not-yet-due" };
  }

  return {
    recommended: true,
    suggestedAt: new Date(asOf.getTime() + FOLLOW_UP_INTERVAL_DAYS * DAY_MS),
    reasonCode: "follow-up-interval-elapsed",
  };
}
