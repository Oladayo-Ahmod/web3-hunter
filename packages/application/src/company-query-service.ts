import { getDb, schema } from "@web3-hunter/db";
import { desc, eq } from "drizzle-orm";
import type { CompanyProfileDTO } from "./dto";
import {
  toCompanyIntelligenceSummaryDTO,
  toCompanySummaryDTO,
  toOpportunityFeedItemDTO,
  toSignalSummaryDTO,
} from "./mappers";

/**
 * The Company Radar read model (docs/DATABASE.md §6): a single Company's
 * current hiring profile, active Opportunities, and recent Signal
 * activity. `recentSignals` is capped, unlike `getOpportunityDetail`'s
 * full Signal list — this surface is a momentum summary, not the
 * evidence trail for one specific score.
 */
const RECENT_SIGNALS_LIMIT = 20;

export async function getCompanyProfile(slug: string): Promise<CompanyProfileDTO | null> {
  const db = getDb();

  const [companyRow] = await db
    .select()
    .from(schema.company)
    .where(eq(schema.company.slug, slug))
    .limit(1);

  if (!companyRow) {
    return null;
  }

  const [opportunityRows, signalRows, intelligenceRows] = await Promise.all([
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
  ]);

  return {
    company: toCompanySummaryDTO(companyRow),
    intelligence: intelligenceRows[0] ? toCompanyIntelligenceSummaryDTO(intelligenceRows[0]) : null,
    activeOpportunities: opportunityRows.map((row) => toOpportunityFeedItemDTO(row, companyRow)),
    recentSignals: signalRows.map(toSignalSummaryDTO),
  };
}
