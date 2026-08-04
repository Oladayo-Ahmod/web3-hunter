import type { RecommendationStatus } from "./types";

export type RecommendationTransitionAction = "dismiss" | "archive" | "restore" | "expire";

/**
 * The Recommendation lifecycle, as an explicit table rather than
 * scattered conditionals, per the Milestone 6 refinement:
 *
 *   active     --dismiss--> dismissed
 *   active     --archive--> archived
 *   active     --expire -->  expired
 *   dismissed  --restore--> active
 *   archived   --restore--> active
 *   expired    (terminal — no transitions out)
 */
const ALLOWED_TRANSITIONS: Readonly<
  Record<
    RecommendationStatus,
    Readonly<Partial<Record<RecommendationTransitionAction, RecommendationStatus>>>
  >
> = {
  active: { dismiss: "dismissed", archive: "archived", expire: "expired" },
  dismissed: { restore: "active" },
  archived: { restore: "active" },
  expired: {},
};

export class InvalidRecommendationTransitionError extends Error {
  constructor(
    public readonly from: RecommendationStatus,
    public readonly action: RecommendationTransitionAction,
  ) {
    super(`Cannot "${action}" a Recommendation in status "${from}".`);
    this.name = "InvalidRecommendationTransitionError";
  }
}

/** Returns the next status for a transition, or throws if it isn't allowed from the current status. */
export function transition(
  from: RecommendationStatus,
  action: RecommendationTransitionAction,
): RecommendationStatus {
  const next = ALLOWED_TRANSITIONS[from][action];
  if (!next) {
    throw new InvalidRecommendationTransitionError(from, action);
  }
  return next;
}

/** Whether a transition is allowed, without throwing — for call sites that want to check first. */
export function canTransition(
  from: RecommendationStatus,
  action: RecommendationTransitionAction,
): boolean {
  return ALLOWED_TRANSITIONS[from][action] !== undefined;
}
