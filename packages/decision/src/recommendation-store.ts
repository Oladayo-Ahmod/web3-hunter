import { getDb, schema } from "@web3-hunter/db";
import { publishEventSafely } from "@web3-hunter/events";
import { deriveDeterministicId } from "@web3-hunter/shared";
import { and, eq } from "drizzle-orm";
import { STALE_EXPIRATION_DAYS } from "./constants";
import {
  RecommendationArchived,
  RecommendationCreated,
  RecommendationDismissed,
  RecommendationExpired,
  RecommendationRestored,
} from "./event-types";
import { computePriority } from "./priority";
import { findRecommendationProvenance } from "./provenance";
import { ELIGIBLE_REASON_CODE, REASON_VERSION } from "./reason-codes";
import { deriveRecommendationId } from "./recommendation-id";
import { evaluateEligibility } from "./registry";
import {
  canTransition,
  InvalidRecommendationTransitionError,
  transition,
  type RecommendationTransitionAction,
} from "./state-machine";
import type { RecommendationStatus } from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A Recommendation's row `id` (deterministic from its Match) and its
 * `RecommendationCreated` Event's `id` are deliberately different values
 * — the row is a stable identity, while the Event is one fact in an
 * immutable log. This derives the latter from the former so lifecycle
 * transitions can cite the real, existing `RecommendationCreated` Event
 * as their provenance, without a database lookup.
 */
export function deriveRecommendationCreatedEventId(recommendationId: string): string {
  return deriveDeterministicId(`web3-hunter:decision:recommendation-created:${recommendationId}`);
}

export interface RecommendationEvaluationResult {
  recommendationId: string;
  /** "created" | "refreshed" (priority updated) | "expired" | "ineligible" (nothing exists and nothing was created) | "unchanged" (exists but not active, pipeline leaves it alone) */
  outcome: "created" | "refreshed" | "expired" | "ineligible" | "unchanged";
}

/**
 * Evaluates one User's Match for Recommendation creation, priority
 * refresh, or staleness expiration — the three concerns this milestone's
 * refinement asked to keep structurally distinct rather than folding into
 * one big conditional:
 *
 * - No existing Recommendation: runs the Decision Rule registry
 *   (`evaluateEligibility`). Eligible → creates it, `RecommendationCreated`
 *   first. Ineligible → nothing is created; eligibility rules only gate
 *   creation, they are never retroactively re-applied to an existing one.
 * - Existing, `active` Recommendation: checked for staleness
 *   (`STALE_EXPIRATION_DAYS` since the Match was last computed) — if
 *   stale, expires it (`RecommendationExpired` first). Otherwise, its
 *   priority is recomputed and the row updated — priority is not itself
 *   event-sourced, only the discrete lifecycle transitions are (Match
 *   owns score; Decision owns priority, continuously).
 * - Existing, non-`active` Recommendation (`dismissed`/`archived`/
 *   `expired`): left untouched — that status is now User- or
 *   staleness-owned, not re-derived from upstream state on every pass.
 */
export async function evaluateRecommendationForMatch(
  userId: string,
  opportunityId: string,
  asOf: Date,
): Promise<RecommendationEvaluationResult | null> {
  const db = getDb();

  const [matchRow] = await db
    .select()
    .from(schema.match)
    .where(and(eq(schema.match.opportunityId, opportunityId), eq(schema.match.userId, userId)))
    .limit(1);
  if (!matchRow) {
    return null;
  }

  const [opportunityRow] = await db
    .select()
    .from(schema.opportunity)
    .where(eq(schema.opportunity.id, opportunityId))
    .limit(1);
  if (!opportunityRow) {
    return null;
  }

  const [intelligenceRow] = await db
    .select()
    .from(schema.companyIntelligence)
    .where(eq(schema.companyIntelligence.companyId, opportunityRow.companyId))
    .limit(1);
  if (!intelligenceRow) {
    return null;
  }

  const recommendationId = deriveRecommendationId(matchRow.id);
  const [existing] = await db
    .select()
    .from(schema.recommendation)
    .where(eq(schema.recommendation.id, recommendationId))
    .limit(1);

  if (!existing) {
    const violation = evaluateEligibility({
      matchScore: matchRow.score,
      matchComputedAt: matchRow.computedAt,
      intelligenceConfidence: intelligenceRow.confidence,
      intelligenceAsOf: intelligenceRow.asOf,
      opportunityStatus: opportunityRow.status,
      asOf,
    });
    if (violation) {
      return { recommendationId, outcome: "ineligible" };
    }

    const priority = computePriority({
      matchScore: matchRow.score,
      intelligenceConfidence: intelligenceRow.confidence,
      intelligenceAsOf: intelligenceRow.asOf,
      recommendationCreatedAt: asOf,
      asOf,
    });
    const provenance = await findRecommendationProvenance(
      userId,
      opportunityRow.companyId,
      opportunityId,
    );

    const eventId = deriveRecommendationCreatedEventId(recommendationId);
    await publishEventSafely({
      id: eventId,
      type: RecommendationCreated.name,
      metadata: {
        recommendationId,
        matchId: matchRow.id,
        opportunityId,
        priority,
        reasonCode: ELIGIBLE_REASON_CODE,
        reasonDetails: {
          matchScore: matchRow.score,
          intelligenceConfidence: intelligenceRow.confidence,
        },
        reasonVersion: REASON_VERSION,
      },
      occurredAt: asOf,
      confidence: matchRow.score,
      sourceLabel: "decision-engine",
      relatedEntityType: "user",
      relatedEntityId: userId,
      provenance,
    });

    await db
      .insert(schema.recommendation)
      .values({
        id: recommendationId,
        userId,
        matchId: matchRow.id,
        opportunityId,
        status: "active",
        priority,
        reasonCode: ELIGIBLE_REASON_CODE,
        reasonDetails: {
          matchScore: matchRow.score,
          intelligenceConfidence: intelligenceRow.confidence,
        },
        reasonVersion: REASON_VERSION,
        createdAt: asOf,
        statusChangedAt: asOf,
      })
      .onConflictDoNothing({ target: schema.recommendation.id });

    return { recommendationId, outcome: "created" };
  }

  if (existing.status !== "active") {
    return { recommendationId, outcome: "unchanged" };
  }

  const staleDays = (asOf.getTime() - matchRow.computedAt.getTime()) / DAY_MS;
  if (staleDays > STALE_EXPIRATION_DAYS) {
    await applyLifecycleTransition(existing, "expire", asOf);
    return { recommendationId, outcome: "expired" };
  }

  const priority = computePriority({
    matchScore: matchRow.score,
    intelligenceConfidence: intelligenceRow.confidence,
    intelligenceAsOf: intelligenceRow.asOf,
    recommendationCreatedAt: existing.createdAt,
    asOf,
  });
  await db
    .update(schema.recommendation)
    .set({
      priority,
      reasonDetails: {
        matchScore: matchRow.score,
        intelligenceConfidence: intelligenceRow.confidence,
      },
      updatedAt: new Date(),
    })
    .where(eq(schema.recommendation.id, recommendationId));

  return { recommendationId, outcome: "refreshed" };
}

const LIFECYCLE_EVENT_TYPE: Record<RecommendationTransitionAction, { name: string }> = {
  dismiss: RecommendationDismissed,
  archive: RecommendationArchived,
  restore: RecommendationRestored,
  expire: RecommendationExpired,
};

type RecommendationRow = typeof schema.recommendation.$inferSelect;

async function applyLifecycleTransition(
  existing: RecommendationRow,
  action: RecommendationTransitionAction,
  asOf: Date,
): Promise<RecommendationStatus> {
  const nextStatus = transition(existing.status, action);
  const eventDefinition = LIFECYCLE_EVENT_TYPE[action];

  const eventId = deriveDeterministicId(
    `web3-hunter:decision:${eventDefinition.name.toLowerCase()}:${existing.id}:${asOf.toISOString()}`,
  );

  await publishEventSafely({
    id: eventId,
    type: eventDefinition.name,
    metadata: {
      recommendationId: existing.id,
      matchId: existing.matchId,
      opportunityId: existing.opportunityId,
    },
    occurredAt: asOf,
    confidence: 1,
    sourceLabel: "decision-engine",
    relatedEntityType: "user",
    relatedEntityId: existing.userId,
    provenance: [deriveRecommendationCreatedEventId(existing.id)],
  });

  await getDb()
    .update(schema.recommendation)
    .set({ status: nextStatus, statusChangedAt: asOf, updatedAt: new Date() })
    .where(eq(schema.recommendation.id, existing.id));

  return nextStatus;
}

async function performTransition(
  recommendationId: string,
  userId: string,
  action: RecommendationTransitionAction,
  asOf: Date,
): Promise<RecommendationStatus> {
  const [existing] = await getDb()
    .select()
    .from(schema.recommendation)
    .where(eq(schema.recommendation.id, recommendationId))
    .limit(1);

  if (!existing || existing.userId !== userId) {
    throw new Error(`Recommendation "${recommendationId}" not found for this User.`);
  }
  if (!canTransition(existing.status, action)) {
    throw new InvalidRecommendationTransitionError(existing.status, action);
  }

  return applyLifecycleTransition(existing, action, asOf);
}

/** Dismiss/archive/restore modify Recommendation state only — never Match, Opportunity, Company Intelligence, Signal, or Event rows beyond the Recommendation's own lifecycle Event. */
export function dismissRecommendation(
  recommendationId: string,
  userId: string,
  asOf: Date = new Date(),
): Promise<RecommendationStatus> {
  return performTransition(recommendationId, userId, "dismiss", asOf);
}

export function archiveRecommendation(
  recommendationId: string,
  userId: string,
  asOf: Date = new Date(),
): Promise<RecommendationStatus> {
  return performTransition(recommendationId, userId, "archive", asOf);
}

export function restoreRecommendation(
  recommendationId: string,
  userId: string,
  asOf: Date = new Date(),
): Promise<RecommendationStatus> {
  return performTransition(recommendationId, userId, "restore", asOf);
}
