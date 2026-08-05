import { describe, expect, it } from "vitest";
import { buildCompanySummaryPrompt } from "./company-summary-prompt";
import { buildOpportunitySummaryPrompt } from "./opportunity-summary-prompt";
import { buildOutreachDraftPrompt } from "./outreach-draft-prompt";
import { buildProfileInsightPrompt } from "./profile-insight-prompt";
import { buildRecommendationExplanationPrompt } from "./recommendation-explanation-prompt";

describe("prompt builders", () => {
  it("buildRecommendationExplanationPrompt embeds every deterministic fact and forbids invention", () => {
    const prompt = buildRecommendationExplanationPrompt({
      companyName: "Acme Labs",
      opportunityType: "engineering-hiring-surge",
      matchScore: 0.85,
      matchReasoning: "Matches 2 of 3 tagged Skills.",
      matchedSkillNames: ["Solidity", "Rust"],
      intelligenceConfidence: 0.7,
      intelligenceTrend: "increasing",
      priority: 0.9,
    });
    expect(prompt).toContain("Acme Labs");
    expect(prompt).toContain("Solidity, Rust");
    expect(prompt).toContain("0.85");
    expect(prompt).toContain("increasing");
    expect(prompt).toMatch(/never invent/i);
  });

  it("buildOpportunitySummaryPrompt embeds Company, score, and Signal evidence", () => {
    const prompt = buildOpportunitySummaryPrompt({
      companyName: "Acme Labs",
      opportunityType: "engineering-hiring-surge",
      score: 0.9,
      reasoning: "Score 0.9 based on 2 Signals.",
      signalSummaries: [
        {
          signalType: "new-backend-role",
          weight: 0.7,
          reasoning: "Posted a Backend Engineer role.",
        },
      ],
    });
    expect(prompt).toContain("Acme Labs");
    expect(prompt).toContain("new-backend-role");
    expect(prompt).toContain("0.90");
  });

  it("buildCompanySummaryPrompt embeds trend, confidence, and recent Signals", () => {
    const prompt = buildCompanySummaryPrompt({
      companyName: "Acme Labs",
      trend: "increasing",
      confidence: 0.8,
      signalCount: 3,
      recentSignalSummaries: [],
    });
    expect(prompt).toContain("Acme Labs");
    expect(prompt).toContain("increasing");
    expect(prompt).toContain("3");
  });

  it("buildOutreachDraftPrompt never names a specific Contact", () => {
    const prompt = buildOutreachDraftPrompt({
      companyName: "Acme Labs",
      opportunityType: "engineering-hiring-surge",
      matchedSkillNames: ["Solidity"],
      matchReasoning: "Matches 1 of 1 tagged Skill.",
    });
    expect(prompt).toContain("Acme Labs");
    expect(prompt).toMatch(/never address it to a named person/i);
  });

  it("buildProfileInsightPrompt embeds declared Skills, deal-breakers, and Matches", () => {
    const prompt = buildProfileInsightPrompt({
      skillNames: ["Solidity", "Rust"],
      dealBreakerSkillNames: ["Java"],
      matchSummaries: [{ companyName: "Acme Labs", score: 0.85 }],
    });
    expect(prompt).toContain("Solidity, Rust");
    expect(prompt).toContain("Java");
    expect(prompt).toContain("Acme Labs");
  });
});
