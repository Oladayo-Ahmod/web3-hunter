/**
 * Stable, API-facing shapes owned by the Application Layer
 * (docs/ARCHITECTURE.md §3, §6). These are deliberately distinct from
 * `@web3-hunter/db`'s row types: every field here is JSON-serializable
 * (dates as ISO strings), and only fields the UI/API actually needs are
 * exposed — no raw database row is ever handed to a consumer of this
 * package.
 */

export type OpportunityStatusDTO = "detected" | "scored";

export type IntelligenceTrendDTO = "insufficient-data" | "increasing" | "stable" | "decreasing";

export interface CompanySummaryDTO {
  id: string;
  slug: string;
  name: string;
}

export interface SignalSummaryDTO {
  id: string;
  signalType: string;
  weight: number;
  reasoning: string;
  detectedAt: string;
}

export interface CompanyIntelligenceSummaryDTO {
  trend: IntelligenceTrendDTO;
  confidence: number;
  signalCount: number;
  lastSignalAt: string | null;
  /** The point in (event) time this Intelligence snapshot reflects. */
  asOf: string;
}

export interface OpportunityFeedItemDTO {
  id: string;
  company: CompanySummaryDTO;
  opportunityType: string;
  status: OpportunityStatusDTO;
  score: number | null;
  detectionWindow: string;
  detectedAt: string;
  scoredAt: string | null;
}

export interface OpportunityDetailDTO extends OpportunityFeedItemDTO {
  reasoning: string;
  /**
   * The Company's full Signal history, which is exactly what
   * `packages/scoring`'s Scoring Engine v1 used to compute this
   * Opportunity's current score (docs/ROADMAP.md Milestone 3) — this list
   * is the literal evidence behind the score, not an approximation of it.
   */
  signals: SignalSummaryDTO[];
  companyIntelligence: CompanyIntelligenceSummaryDTO | null;
  freshness: {
    lastSignalAt: string | null;
    asOf: string | null;
  };
}

export interface CompanyProfileDTO {
  company: CompanySummaryDTO;
  intelligence: CompanyIntelligenceSummaryDTO | null;
  /**
   * Every Opportunity detected for this Company. There is no
   * archived/expired Opportunity state yet (docs/DATABASE.md §Opportunity
   * lifecycle), so "active" currently means "all of them."
   */
  activeOpportunities: OpportunityFeedItemDTO[];
  recentSignals: SignalSummaryDTO[];
}

export interface PaginatedResult<T> {
  items: T[];
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
}

export interface SearchResultDTO {
  companies: CompanySummaryDTO[];
  opportunities: OpportunityFeedItemDTO[];
}
