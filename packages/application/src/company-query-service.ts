import { getDb, schema } from "@web3-hunter/db";
import { and, desc, eq, inArray } from "drizzle-orm";
import { getLatestCompanySummary } from "./ai-artifact-lookup";
import type { CompanyProfileDTO } from "./dto";
import {
  toCompanyIntelligenceSummaryDTO,
  toCompanySummaryDTO,
  toCompanyTechnologyProfileDTO,
  toOpportunityFeedItemDTO,
  toSignalSummaryDTO,
} from "./mappers";
import { resolveSkillsById } from "./skill-lookup";

/**
 * The Company Radar read model (docs/DATABASE.md §6): a single Company's
 * current hiring profile, active Opportunities, and recent Signal
 * activity. `recentSignals` is capped, unlike `getOpportunityDetail`'s
 * full Signal list — this surface is a momentum summary, not the
 * evidence trail for one specific score.
 *
 * `viewerId` must come from the caller's resolved session — see
 * `listOpportunityFeed`'s equivalent note. When present, each Opportunity
 * includes that viewer's Match, if one has been computed.
 */
const RECENT_SIGNALS_LIMIT = 20;

export async function getCompanyProfile(
  slug: string,
  viewerId?: string,
): Promise<CompanyProfileDTO | null> {
  const db = getDb();

  const [companyRow] = await db
    .select()
    .from(schema.company)
    .where(eq(schema.company.slug, slug))
    .limit(1);

  if (!companyRow) {
    return null;
  }

  const [opportunityRows, signalRows, intelligenceRows, technologyProfileRows, aiSummary] =
    await Promise.all([
      db
        .select()
        .from(schema.opportunity)
        .where(eq(schema.opportunity.companyId, companyRow.id))
        .orderBy(desc(schema.opportunity.detectedAt)),
      db
        .select()
        .from(schema.signal)
        .where(eq(schema.signal.companyId, companyRow.id))
        .orderBy(desc(schema.signal.detectedAt))
        .limit(RECENT_SIGNALS_LIMIT),
      db
        .select()
        .from(schema.companyIntelligence)
        .where(eq(schema.companyIntelligence.companyId, companyRow.id))
        .limit(1),
      db
        .select()
        .from(schema.companyTechnologyProfile)
        .where(eq(schema.companyTechnologyProfile.companyId, companyRow.id))
        .limit(1),
      getLatestCompanySummary(companyRow.id),
    ]);

  const matchByOpportunityId =
    viewerId && opportunityRows.length > 0
      ? new Map(
          (
            await db
              .select()
              .from(schema.match)
              .where(
                and(
                  eq(schema.match.userId, viewerId),
                  inArray(
                    schema.match.opportunityId,
                    opportunityRows.map((row) => row.id),
                  ),
                ),
              )
          ).map((row) => [row.opportunityId, row]),
        )
      : new Map();

  const technologyProfileRow = technologyProfileRows[0] ?? null;
  const skillById = await resolveSkillsById([
    ...[...matchByOpportunityId.values()].flatMap((row) => row.matchedSkillIds),
    ...[...matchByOpportunityId.values()].flatMap((row) => row.matchedTechnologySkillIds),
    ...(technologyProfileRow?.skillIds ?? []),
  ]);

  return {
    company: toCompanySummaryDTO(companyRow),
    intelligence: intelligenceRows[0] ? toCompanyIntelligenceSummaryDTO(intelligenceRows[0]) : null,
    activeOpportunities: opportunityRows.map((row) =>
      toOpportunityFeedItemDTO(row, companyRow, matchByOpportunityId.get(row.id), skillById),
    ),
    recentSignals: signalRows.map(toSignalSummaryDTO),
    technologyProfile: technologyProfileRow
      ? toCompanyTechnologyProfileDTO(technologyProfileRow, skillById)
      : null,
    aiSummary,
  };
}
