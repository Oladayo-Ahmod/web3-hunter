import type { ProfileInsightContext } from "./types";

export const PROFILE_INSIGHT_PROMPT_VERSION = 1;

export function buildProfileInsightPrompt(context: ProfileInsightContext): string {
  const matchLines = context.matchSummaries
    .map((match) => `- ${match.companyName}: score ${match.score.toFixed(2)}`)
    .join("\n");

  return [
    "You are giving a Web3 engineer a short, encouraging insight into how their declared Skills are positioning them in the job market.",
    "Write 2-3 sentences. Ground every claim in the facts below — never invent a fact not listed here.",
    "",
    `Declared Skills: ${context.skillNames.join(", ") || "none listed"}`,
    `Deal-breaker Skills (roles requiring these are excluded): ${context.dealBreakerSkillNames.join(", ") || "none"}`,
    "Current Matches:",
    matchLines || "(none yet)",
    "",
    "Write the insight now, addressed directly to the engineer, in plain text with no markup.",
  ].join("\n");
}
