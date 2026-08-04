import { schema } from "@web3-hunter/db";
import type {
  CompanyIntelligenceSummaryDTO,
  CompanySummaryDTO,
  OpportunityFeedItemDTO,
  SignalSummaryDTO,
} from "./dto";

type CompanyRow = typeof schema.company.$inferSelect;
type OpportunityRow = typeof schema.opportunity.$inferSelect;
type SignalRow = typeof schema.signal.$inferSelect;
type CompanyIntelligenceRow = typeof schema.companyIntelligence.$inferSelect;

export function toCompanySummaryDTO(row: CompanyRow): CompanySummaryDTO {
  return { id: row.id, slug: row.slug, name: row.name };
}

export function toSignalSummaryDTO(row: SignalRow): SignalSummaryDTO {
  return {
    id: row.id,
    signalType: row.signalType,
    weight: row.weight,
    reasoning: row.reasoning,
    detectedAt: row.detectedAt.toISOString(),
  };
}

export function toCompanyIntelligenceSummaryDTO(
  row: CompanyIntelligenceRow,
): CompanyIntelligenceSummaryDTO {
  return {
    trend: row.trend,
    confidence: row.confidence,
    signalCount: row.signalCount,
    lastSignalAt: row.lastSignalAt ? row.lastSignalAt.toISOString() : null,
    asOf: row.asOf.toISOString(),
  };
}

export function toOpportunityFeedItemDTO(
  opportunity: OpportunityRow,
  company: CompanyRow,
): OpportunityFeedItemDTO {
  return {
    id: opportunity.id,
    company: toCompanySummaryDTO(company),
    opportunityType: opportunity.opportunityType,
    status: opportunity.status,
    score: opportunity.score,
    detectionWindow: opportunity.detectionWindow,
    detectedAt: opportunity.detectedAt.toISOString(),
    scoredAt: opportunity.scoredAt ? opportunity.scoredAt.toISOString() : null,
  };
}
