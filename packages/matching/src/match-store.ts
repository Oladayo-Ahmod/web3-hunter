import { getDb, schema } from "@web3-hunter/db";
import { publishEventSafely } from "@web3-hunter/events";
import { deriveDeterministicId } from "@web3-hunter/shared";
import { eq } from "drizzle-orm";
import { MatchComputed } from "./event-types";
import { deriveMatchId } from "./match-id";
import { computeMatch, matchComputationsEqual } from "./matching";
import { getUserProfile } from "./user-profile-store";

export interface MatchEvaluationResult {
  matchId: string;
  /** Whether this call created the Match or changed its score/reasoning. */
  computed: boolean;
}

/**
 * Evaluates the Match between a User and one Opportunity, publishing
 * `MatchComputed` and (re)writing the `match` projection only when the
 * result actually differs from what's stored — the same
 * "publish only on real change" discipline `packages/scoring`'s
 * `evaluateOpportunity` follows, which is what keeps repeated pipeline
 * runs from generating a storm of no-op Events.
 *
 * Returns `null` when there is nothing to compute a Match on: no User
 * Profile yet, the Opportunity isn't `scored` yet (per
 * docs/DOMAIN_MODEL.md's Opportunity lifecycle — Matched follows
 * Scored/Updated), the Opportunity has no classified Skills yet (nothing
 * to found a provenance-bearing Match on), or the Opportunity is excluded
 * by one of the User's deal-breaker Skills — the hard-filter invariant
 * from docs/DOMAIN_MODEL.md's Domain Rules: excluded outright, not
 * soft-scored down.
 */
export async function evaluateMatch(
  userId: string,
  opportunityId: string,
  asOf: Date,
): Promise<MatchEvaluationResult | null> {
  const db = getDb();

  const [opportunityRow] = await db
    .select()
    .from(schema.opportunity)
    .where(eq(schema.opportunity.id, opportunityId))
    .limit(1);
  if (!opportunityRow || opportunityRow.status !== "scored") {
    return null;
  }

  const profile = await getUserProfile(userId);
  if (!profile) {
    return null;
  }

  const opportunitySkillRows = await db
    .select()
    .from(schema.opportunitySkill)
    .where(eq(schema.opportunitySkill.opportunityId, opportunityId));
  if (opportunitySkillRows.length === 0) {
    return null;
  }

  const opportunitySkillIds = opportunitySkillRows.map((row) => row.skillId);
  const hasDealBreaker = opportunitySkillIds.some((skillId) =>
    profile.dealBreakerSkillIds.includes(skillId),
  );
  if (hasDealBreaker) {
    return null;
  }

  // Milestone 9: the Opportunity's Company's GitHub-evidenced technology
  // stack, if any — read directly from `packages/technology`'s
  // projection via `packages/db`, never by importing that package (the
  // same "read the projection, not the producer" pattern this function
  // already uses for `opportunity_skill`). Absent, not empty-and-scored,
  // when the Company has no Technology Profile yet.
  const [technologyProfileRow] = await db
    .select()
    .from(schema.companyTechnologyProfile)
    .where(eq(schema.companyTechnologyProfile.companyId, opportunityRow.companyId))
    .limit(1);
  const companyTechnologySkillIds = technologyProfileRow?.skillIds ?? [];

  const computation = computeMatch(
    profile.skillIds,
    opportunitySkillIds,
    companyTechnologySkillIds,
  );
  const matchId = deriveMatchId({ userId, opportunityId });

  const [existing] = await db
    .select()
    .from(schema.match)
    .where(eq(schema.match.id, matchId))
    .limit(1);
  if (existing && matchComputationsEqual(computation, existing)) {
    return { matchId, computed: false };
  }

  const eventId = deriveDeterministicId(
    `web3-hunter:matching:match-computed:${matchId}:${asOf.toISOString()}:` +
      `${computation.matchedSkillIds.length}:${computation.matchedTechnologySkillIds.length}`,
  );

  await publishEventSafely({
    id: eventId,
    type: MatchComputed.name,
    metadata: {
      opportunityId,
      score: computation.score,
      reasoning: computation.reasoning,
      matchedSkillIds: [...computation.matchedSkillIds],
      matchedTechnologySkillIds: [...computation.matchedTechnologySkillIds],
    },
    occurredAt: asOf,
    confidence: computation.score,
    sourceLabel: "matching-engine",
    relatedEntityType: "user",
    relatedEntityId: userId,
    // The full set of this Opportunity's classified Skills considered —
    // not only the matched subset — so provenance stays non-empty even
    // for a zero-overlap Match, and honestly reflects everything the
    // computation weighed. Company Technology Profile evidence is
    // deliberately not added here: `technology_detection` rows are
    // Company-scoped, not Opportunity-scoped, and citing them would mix
    // two different evidentiary chains under one Match Event.
    provenance: opportunitySkillRows.map((row) => row.id),
  });

  await db
    .insert(schema.match)
    .values({
      id: matchId,
      userId,
      opportunityId,
      score: computation.score,
      reasoning: computation.reasoning,
      matchedSkillIds: [...computation.matchedSkillIds],
      matchedTechnologySkillIds: [...computation.matchedTechnologySkillIds],
      computedAt: asOf,
    })
    .onConflictDoUpdate({
      target: schema.match.id,
      set: {
        score: computation.score,
        reasoning: computation.reasoning,
        matchedSkillIds: [...computation.matchedSkillIds],
        matchedTechnologySkillIds: [...computation.matchedTechnologySkillIds],
        computedAt: asOf,
        updatedAt: new Date(),
      },
    });

  return { matchId, computed: true };
}
