/**
 * Every prompt builder in this directory is a pure function: deterministic
 * data in, a prompt string out — no I/O, no provider call. This is what
 * keeps prompt construction unit-testable independent of any provider,
 * and what makes "grounded in cited events" mechanical rather than
 * aspirational: a prompt can only ever reference the deterministic data
 * it was handed, never invent it.
 */

export interface RecommendationExplanationContext {
  companyName: string;
  opportunityType: string;
  matchScore: number;
  matchReasoning: string;
  matchedSkillNames: readonly string[];
  intelligenceConfidence: number;
  intelligenceTrend: string;
  priority: number;
}

export interface OpportunitySummaryContext {
  companyName: string;
  opportunityType: string;
  score: number;
  reasoning: string;
  signalSummaries: readonly { signalType: string; weight: number; reasoning: string }[];
}

export interface CompanySummaryContext {
  companyName: string;
  trend: string;
  confidence: number;
  signalCount: number;
  recentSignalSummaries: readonly { signalType: string; weight: number; reasoning: string }[];
}

export interface OutreachDraftContext {
  companyName: string;
  opportunityType: string;
  matchedSkillNames: readonly string[];
  matchReasoning: string;
}

export interface ProfileInsightContext {
  skillNames: readonly string[];
  dealBreakerSkillNames: readonly string[];
  matchSummaries: readonly { companyName: string; score: number }[];
}
