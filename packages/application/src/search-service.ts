import { getDb, schema } from "@web3-hunter/db";
import { eq, ilike, or, type SQL, sql } from "drizzle-orm";
import { z } from "zod";
import type { SearchResultDTO } from "./dto";
import { toCompanySummaryDTO, toOpportunityFeedItemDTO } from "./mappers";

export const searchQuerySchema = z.object({
  q: z.string().min(1),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});
export type SearchQuery = z.infer<typeof searchQuerySchema>;

/**
 * Escapes Postgres `LIKE`/`ILIKE` wildcard characters in user-supplied
 * search text, so a literal search for e.g. "50%" matches a company named
 * "50% Labs" instead of "%" being interpreted as a wildcard. Postgres's
 * default `LIKE` escape character is backslash, so no `ESCAPE` clause is
 * needed alongside this.
 */
function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/**
 * The Search read model (docs/ROADMAP.md Milestone 4): a combined,
 * text-matched view over Companies and Opportunities. Matches on Company
 * name/slug and Opportunity type — the only free-text-searchable fields
 * the current domain model exposes (see the Milestone 4 Definition of
 * Ready's scope note on chain/language/company-stage filtering being
 * deferred until those fields exist).
 */
export async function search(query: SearchQuery): Promise<SearchResultDTO> {
  const db = getDb();
  const pattern = `%${escapeLikePattern(query.q)}%`;
  const companyMatch: SQL = or(
    ilike(schema.company.name, pattern),
    ilike(schema.company.slug, pattern),
  )!;

  const [companyRows, opportunityRows] = await Promise.all([
    db.select().from(schema.company).where(companyMatch).limit(query.limit),
    db
      .select({ opportunity: schema.opportunity, company: schema.company })
      .from(schema.opportunity)
      .innerJoin(schema.company, eq(schema.opportunity.companyId, schema.company.id))
      .where(or(companyMatch, ilike(schema.opportunity.opportunityType, pattern)))
      .orderBy(sql`${schema.opportunity.score} DESC NULLS LAST`)
      .limit(query.limit),
  ]);

  return {
    companies: companyRows.map(toCompanySummaryDTO),
    opportunities: opportunityRows.map((row) =>
      toOpportunityFeedItemDTO(row.opportunity, row.company),
    ),
  };
}
