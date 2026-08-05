import { schema } from "@web3-hunter/db";
import type {
  CollectorHealthDTO,
  CompanyIntelligenceSummaryDTO,
  CompanySummaryDTO,
  MatchSummaryDTO,
  OpportunityFeedItemDTO,
  SignalSummaryDTO,
  SkillDTO,
} from "./dto";

type CompanyRow = typeof schema.company.$inferSelect;
type OpportunityRow = typeof schema.opportunity.$inferSelect;
type SignalRow = typeof schema.signal.$inferSelect;
type CompanyIntelligenceRow = typeof schema.companyIntelligence.$inferSelect;
type MatchRow = typeof schema.match.$inferSelect;
type SkillRow = typeof schema.skill.$inferSelect;
type CollectorRow = typeof schema.collector.$inferSelect;

export function toCompanySummaryDTO(row: CompanyRow): CompanySummaryDTO {
  return { id: row.id, slug: row.slug, name: row.name };
}

export function toSkillDTO(row: SkillRow): SkillDTO {
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

/**
 * `skillById` resolves a Match's `matchedSkillIds` into displayable Skill
 * entries — callers batch-fetch this once per page of results rather than
 * this function querying `packages/db` itself, keeping every mapper here
 * a pure, synchronous transform.
 */
export function toMatchSummaryDTO(
  row: MatchRow,
  skillById: ReadonlyMap<string, SkillDTO>,
): MatchSummaryDTO {
  return {
    score: row.score,
    reasoning: row.reasoning,
    matchedSkills: row.matchedSkillIds
      .map((skillId) => skillById.get(skillId))
      .filter((skill): skill is SkillDTO => skill !== undefined),
  };
}

export function toOpportunityFeedItemDTO(
  opportunity: OpportunityRow,
  company: CompanyRow,
  match?: MatchRow | null,
  skillById?: ReadonlyMap<string, SkillDTO>,
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
    match: match ? toMatchSummaryDTO(match, skillById ?? new Map()) : null,
  };
}

export function toCollectorHealthDTO(row: CollectorRow): CollectorHealthDTO {
  return {
    id: row.id,
    slug: row.slug,
    sourceType: row.sourceType,
    status: row.status,
    consecutiveFailures: row.consecutiveFailures,
    lastRunAt: row.lastRunAt ? row.lastRunAt.toISOString() : null,
    lastErrorAt: row.lastErrorAt ? row.lastErrorAt.toISOString() : null,
    lastErrorMessage: row.lastErrorMessage,
    lastRunRecordsProcessed: row.lastRunRecordsProcessed,
    lastRunRecordsPublished: row.lastRunRecordsPublished,
    lastRunDurationMs: row.lastRunDurationMs,
  };
}
