import type { OutreachDraftContext } from "./types";

export const OUTREACH_DRAFT_PROMPT_VERSION = 1;

/**
 * Drafts a generic outreach message about a Company/Opportunity — not
 * addressed to a specific Contact, since `Contact` (docs/DOMAIN_MODEL.md)
 * has no implemented data source yet (deferred to when a Collector
 * actually produces Contact data, the same "no data, no feature yet"
 * discipline Milestones 4/5 applied to company-stage and Tech Stack).
 */
export function buildOutreachDraftPrompt(context: OutreachDraftContext): string {
  return [
    "You are drafting a short, professional outreach message a Web3 engineer could send to express interest in a hiring Opportunity.",
    "Write 3-4 sentences, first person, no greeting/signature block (the engineer will add those).",
    "Ground every claim in the facts below — never invent a fact not listed here, and never address it to a named person (none is known).",
    "",
    `Company: ${context.companyName}`,
    `Opportunity type: ${context.opportunityType}`,
    `Matched Skills: ${context.matchedSkillNames.join(", ") || "none listed"}`,
    `Match reasoning: ${context.matchReasoning}`,
    "",
    "Write the draft now, in plain text with no markup.",
  ].join("\n");
}
