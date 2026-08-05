import type { CompanySummaryContext } from "./types";

export const COMPANY_SUMMARY_PROMPT_VERSION = 1;

export function buildCompanySummaryPrompt(context: CompanySummaryContext): string {
  const signalLines = context.recentSignalSummaries
    .map(
      (signal) =>
        `- ${signal.signalType} (weight ${signal.weight.toFixed(2)}): ${signal.reasoning}`,
    )
    .join("\n");

  return [
    "You are summarizing a Company's current hiring momentum for a Web3 engineer.",
    "Write 2-3 sentences. Ground every claim in the facts below — never invent a fact not listed here.",
    "",
    `Company: ${context.companyName}`,
    `Hiring trend: ${context.trend}`,
    `Confidence: ${context.confidence.toFixed(2)}`,
    `Signal count: ${context.signalCount}`,
    "Recent Signals:",
    signalLines || "(none)",
    "",
    "Write the summary now, in plain text with no markup.",
  ].join("\n");
}
