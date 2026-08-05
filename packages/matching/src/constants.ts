/**
 * Named weights for Match score's two components, per docs/ROADMAP.md
 * Milestone 9: Skill fit (an Opportunity's job-posting-derived tags) and
 * Technology fit (its Company's GitHub-evidenced tech stack). Must sum
 * to 1. A first, defensible v1 split, not a calibrated model — the same
 * spirit as every other formula in this system (Scoring Engine v1,
 * `packages/decision`'s Priority formula). No magic numbers: every
 * weight `packages/matching` uses is defined here.
 */
export const SKILL_FIT_WEIGHT = 0.7;
export const TECHNOLOGY_FIT_WEIGHT = 0.3;
