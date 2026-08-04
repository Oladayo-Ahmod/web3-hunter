/**
 * The reason a Recommendation exists, when every Decision Rule passed.
 * Distinct from the individual rules' violation `reasonCode`s (those
 * explain why a Match was rejected; this explains why one was accepted).
 */
export const ELIGIBLE_REASON_CODE = "eligibility-rules-passed";

/**
 * A schema-version marker for `reasonCode`/`reasonDetails`' shape — the
 * same convention `EventTypeDefinition.version` uses, incremented only if
 * a future change alters what these fields contain, never as a
 * per-recompute counter. The Application Layer selects how to render a
 * given `reasonVersion`'s `reasonCode`/`reasonDetails` shape.
 */
export const REASON_VERSION = 1;
