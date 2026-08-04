/**
 * Named thresholds for Decision Rules and the priority formula — a first,
 * defensible version, not a calibrated model, per the same spirit as
 * Scoring Engine v1 (docs/ROADMAP.md Milestone 3). No magic numbers: every
 * threshold used anywhere in `packages/decision` is defined here.
 */

/** Minimum Match score for a Recommendation to be created. */
export const MIN_RELEVANCE_THRESHOLD = 0.5;

/** Minimum Company Intelligence confidence for a Recommendation to be created. */
export const MIN_CONFIDENCE_THRESHOLD = 0.4;

/** Company Intelligence older than this (days, relative to evaluation time) blocks new Recommendation creation. */
export const FRESHNESS_WINDOW_DAYS = 30;

/** An active Recommendation whose Match hasn't been recomputed within this window (days) expires. Deliberately longer than FRESHNESS_WINDOW_DAYS: creation is stricter than staying alive. */
export const STALE_EXPIRATION_DAYS = 60;

/** Priority formula weights (docs/DOMAIN_MODEL.md: Match owns score, Decision owns priority) — must sum to 1. */
export const PRIORITY_WEIGHT_MATCH_SCORE = 0.5;
export const PRIORITY_WEIGHT_INTELLIGENCE_CONFIDENCE = 0.3;
export const PRIORITY_WEIGHT_FRESHNESS = 0.2;

/** Fractional priority reduction per day of Recommendation age, floored at zero remaining weight. */
export const PRIORITY_AGE_DECAY_PER_DAY = 0.02;

/** The maximum number of Recommendations `selectDigestCandidates` returns for one User. */
export const MAX_DIGEST_CANDIDATES = 10;

/** How many days an active, unaddressed Recommendation waits before a follow-up is suggested. */
export const FOLLOW_UP_INTERVAL_DAYS = 14;
