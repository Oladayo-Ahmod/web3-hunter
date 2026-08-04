import { getDb, schema } from "@web3-hunter/db";
import { deriveDeterministicId } from "@web3-hunter/shared";
import { asc, eq } from "drizzle-orm";
import { computeDetectionWindow } from "./detection-window";
import { OpportunityDetected, OpportunityScored } from "./event-types";
import { meetsOpportunityThreshold } from "./opportunity-detection";
import { ENGINEERING_HIRING_SURGE, deriveOpportunityId } from "./opportunity-id";
import { publishEventSafely } from "./publish-safely";
import { computeOpportunityScore } from "./scoring";
import type { CompanyIntelligenceState, SignalSummary } from "./types";

async function getCompanySignals(companyId: string): Promise<SignalSummary[]> {
  const rows = await getDb()
    .select()
    .from(schema.signal)
    .where(eq(schema.signal.companyId, companyId))
    .orderBy(asc(schema.signal.detectedAt), asc(schema.signal.id));

  return rows.map((row) => ({
    id: row.id,
    signalType: row.signalType,
    weight: row.weight,
    detectedAt: row.detectedAt,
  }));
}

export interface OpportunityEvaluationResult {
  opportunityId: string;
  /** Whether this call newly detected the Opportunity (vs. it already existing). */
  detected: boolean;
  /** Whether this call published a new score (vs. the score being unchanged). */
  scored: boolean;
}

/**
 * Evaluates whether a Company's current Intelligence satisfies the
 * Opportunity-detection threshold (`meetsOpportunityThreshold`), and if
 * so, ensures the corresponding (deterministic-ID) Opportunity exists and
 * is (re)scored. `OpportunityDetected` and `OpportunityScored` are always
 * published before the `opportunity` projection is written, per the same
 * event-sourced-projection discipline the approved refinement establishes
 * for Company Intelligence.
 *
 * Returns `null` if the threshold isn't met — this is the mechanism that
 * makes "an Opportunity should only exist when predefined conditions are
 * satisfied" true: nothing is written at all otherwise.
 */
export async function evaluateOpportunity(
  companyId: string,
  intelligence: CompanyIntelligenceState,
  asOf: Date,
): Promise<OpportunityEvaluationResult | null> {
  if (!meetsOpportunityThreshold(intelligence)) {
    return null;
  }

  const opportunityType = ENGINEERING_HIRING_SURGE;
  const detectionWindow = computeDetectionWindow(asOf);
  const opportunityId = deriveOpportunityId({ companyId, opportunityType, detectionWindow });

  const db = getDb();
  const signals = await getCompanySignals(companyId);
  const signalIds = signals.map((signal) => signal.id);

  const [existingBeforeDetection] = await db
    .select()
    .from(schema.opportunity)
    .where(eq(schema.opportunity.id, opportunityId))
    .limit(1);

  let detected = false;
  if (!existingBeforeDetection) {
    const reasoning =
      `Detected: confidence ${intelligence.confidence.toFixed(2)}, ${intelligence.signalCount} signal(s), ` +
      `trend ${intelligence.trend}, within window ${detectionWindow}.`;
    const detectedEventId = deriveDeterministicId(
      `web3-hunter:scoring:opportunity-detected:${opportunityId}`,
    );

    await publishEventSafely({
      id: detectedEventId,
      type: OpportunityDetected.name,
      metadata: { opportunityId, opportunityType, detectionWindow, reasoning },
      occurredAt: asOf,
      confidence: intelligence.confidence,
      sourceLabel: "scoring-engine",
      relatedEntityType: "company",
      relatedEntityId: companyId,
      provenance: signalIds,
    });

    await db
      .insert(schema.opportunity)
      .values({
        id: opportunityId,
        companyId,
        opportunityType,
        detectionWindow,
        status: "detected",
        reasoning,
        detectedAt: asOf,
      })
      .onConflictDoNothing({ target: schema.opportunity.id });

    detected = true;
  }

  const { score, reasoning: scoreReasoning } = computeOpportunityScore(signals, intelligence);

  const [current] = await db
    .select()
    .from(schema.opportunity)
    .where(eq(schema.opportunity.id, opportunityId))
    .limit(1);

  if (!current) {
    throw new Error(
      `Opportunity "${opportunityId}" should exist after detection but was not found.`,
    );
  }

  let scored = false;
  if (current.score === null || current.score !== score) {
    const scoreEventId = deriveDeterministicId(
      `web3-hunter:scoring:opportunity-scored:${opportunityId}:${asOf.toISOString()}:${signals.length}`,
    );

    await publishEventSafely({
      id: scoreEventId,
      type: OpportunityScored.name,
      metadata: { opportunityId, score, reasoning: scoreReasoning },
      occurredAt: asOf,
      confidence: intelligence.confidence,
      sourceLabel: "scoring-engine",
      relatedEntityType: "company",
      relatedEntityId: companyId,
      provenance: signalIds,
    });

    await db
      .update(schema.opportunity)
      .set({ status: "scored", score, scoredAt: asOf, updatedAt: new Date() })
      .where(eq(schema.opportunity.id, opportunityId));

    scored = true;
  }

  return { opportunityId, detected, scored };
}
