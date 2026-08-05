/**
 * Renders `packages/decision`'s structured `reasonCode`/`reasonDetails`/
 * `reasonVersion` into user-facing wording — per the Milestone 6
 * refinement, the Decision Engine stores structured data only; the
 * Application Layer owns presentation. `reasonCode` is a string literal
 * here, not imported from `packages/decision` (packages/application never
 * depends on domain packages — the same "string literal, not imported"
 * convention `packages/scoring`'s detectors use for Event type names),
 * kept in sync with `packages/decision`'s `ELIGIBLE_REASON_CODE`.
 */
const ELIGIBLE_REASON_CODE = "eligibility-rules-passed";

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function renderRecommendationReason(
  reasonCode: string,
  reasonDetails: Record<string, unknown>,
  reasonVersion: number,
): string {
  if (reasonVersion === 1 && reasonCode === ELIGIBLE_REASON_CODE) {
    const { matchScore, intelligenceConfidence, technologyFitConsidered } = reasonDetails;
    if (isFiniteNumber(matchScore) && isFiniteNumber(intelligenceConfidence)) {
      const base =
        `Recommended: ${Math.round(matchScore * 100)}% Match relevance and ` +
        `${Math.round(intelligenceConfidence * 100)}% Company Intelligence confidence ` +
        "both cleared this Opportunity's eligibility thresholds.";

      // Milestone 9: mentioned only when the underlying Match actually had
      // Technology Profile evidence to weigh — `packages/decision` stores
      // the fact, this renders it; see `packages/matching`'s
      // `computeMatch` for where the fit itself is computed.
      return technologyFitConsidered === true
        ? `${base} This Company's GitHub-evidenced technologies also aligned with your declared Skills.`
        : base;
    }
  }

  return "This Opportunity was recommended by the Decision Engine.";
}
