import { getDb, schema } from "@web3-hunter/db";
import { and, desc, eq, sql } from "drizzle-orm";

/**
 * Finds the most recently recorded Event of `type` for a given User whose
 * `metadata.opportunityId` matches — used to cite real provenance for
 * `RecommendationCreated` (the MatchComputed and OpportunityScored facts
 * this decision was made from). `match`/`opportunity` rows are mutable
 * projections, not Events themselves, so a Recommendation cannot cite
 * them directly as `event_provenance` — it cites the Events that last
 * produced their current state instead.
 */
async function findLatestEventId(
  type: string,
  relatedEntityType: string,
  relatedEntityId: string,
  opportunityId: string,
): Promise<string | null> {
  const [row] = await getDb()
    .select({ id: schema.event.id })
    .from(schema.event)
    .where(
      and(
        eq(schema.event.type, type),
        eq(schema.event.relatedEntityType, relatedEntityType),
        eq(schema.event.relatedEntityId, relatedEntityId),
        sql`${schema.event.metadata} ->> 'opportunityId' = ${opportunityId}`,
      ),
    )
    .orderBy(desc(schema.event.recordedAt))
    .limit(1);

  return row?.id ?? null;
}

/**
 * The real Event IDs a `RecommendationCreated` Event should cite as
 * provenance: the most recent `MatchComputed` (relatedEntityType "user")
 * that produced this Match's current score, and the most recent
 * `OpportunityScored` (relatedEntityType "company") that produced this
 * Opportunity's current score. Both are guaranteed to exist by the time
 * this is called — every Decision Rule that gates creation already
 * requires the Match and Opportunity to be in a state only those Events
 * could have produced.
 */
export async function findRecommendationProvenance(
  userId: string,
  companyId: string,
  opportunityId: string,
): Promise<string[]> {
  const [matchComputedId, opportunityScoredId] = await Promise.all([
    findLatestEventId("MatchComputed", "user", userId, opportunityId),
    findLatestEventId("OpportunityScored", "company", companyId, opportunityId),
  ]);

  return [matchComputedId, opportunityScoredId].filter((id): id is string => id !== null);
}
