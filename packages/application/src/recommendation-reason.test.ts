import { describe, expect, it } from "vitest";
import { renderRecommendationReason } from "./recommendation-reason";

describe("renderRecommendationReason", () => {
  it("renders the eligibility sentence for the known reason code/version", () => {
    const reason = renderRecommendationReason(
      "eligibility-rules-passed",
      { matchScore: 0.8, intelligenceConfidence: 0.6 },
      1,
    );
    expect(reason).toContain("80% Match relevance");
    expect(reason).toContain("60% Company Intelligence confidence");
    expect(reason).not.toContain("GitHub");
  });

  it("mentions Technology alignment when the underlying Match considered it (Milestone 9)", () => {
    const reason = renderRecommendationReason(
      "eligibility-rules-passed",
      { matchScore: 0.8, intelligenceConfidence: 0.6, technologyFitConsidered: true },
      1,
    );
    expect(reason).toContain("GitHub-evidenced technologies also aligned");
  });

  it("omits the Technology mention when the underlying Match had no evidence", () => {
    const reason = renderRecommendationReason(
      "eligibility-rules-passed",
      { matchScore: 0.8, intelligenceConfidence: 0.6, technologyFitConsidered: false },
      1,
    );
    expect(reason).not.toContain("GitHub");
  });

  it("falls back to a generic sentence for an unrecognized reason code", () => {
    const reason = renderRecommendationReason("something-unknown", {}, 1);
    expect(reason).toBe("This Opportunity was recommended by the Decision Engine.");
  });

  it("falls back to a generic sentence when required fields are missing", () => {
    const reason = renderRecommendationReason("eligibility-rules-passed", {}, 1);
    expect(reason).toBe("This Opportunity was recommended by the Decision Engine.");
  });
});
