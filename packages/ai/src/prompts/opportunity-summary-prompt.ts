import type { OpportunitySummaryContext } from "./types";

export const OPPORTUNITY_SUMMARY_PROMPT_VERSION = 1;

export function buildOpportunitySummaryPrompt(context: OpportunitySummaryContext): string {
  const signalLines = context.signalSummaries
    .map(
      (signal) =>
        `- ${signal.signalType} (weight ${signal.weight.toFixed(2)}): ${signal.reasoning}`,
    )
    .join("\n");

  return [
    "You are summarizing a hiring Opportunity for a Web3 engineer browsing a job feed.",
    "Write 2-3 sentences. Ground every claim in the facts below — never invent a fact not listed here.",
    "",
    `Company: ${context.companyName}`,
    `Opportunity type: ${context.opportunityType}`,
    `Score: ${context.score.toFixed(2)} (reasoning: ${context.reasoning})`,
    "Supporting Signals:",
    signalLines || "(none)",
    "",
    "Write the summary now, in plain text with no markup.",
  ].join("\n");
}
