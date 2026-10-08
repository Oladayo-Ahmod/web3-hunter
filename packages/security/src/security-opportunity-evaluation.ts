import { getDb, schema } from "@web3-hunter/db";
import { publishEventSafely } from "@web3-hunter/events";
import { deriveDeterministicId } from "@web3-hunter/shared";
import { asc, eq } from "drizzle-orm";
import { SecurityOpportunityDetected } from "./event-types";
import { ACTIVE_PROTOCOL, deriveSecurityOpportunityId } from "./opportunity-id";
import { computeSecurityDetectionWindow } from "./security-detection-window";
import { meetsSecurityOpportunityThreshold } from "./security-opportunity-detection";
import { createSecurityOpportunity } from "./security-opportunity-store";
import type { SecurityTargetIntelligenceState } from "./types";

async function getSecurityTargetSignalIds(securityTargetId: string): Promise<string[]> {
  const rows = await getDb()
    .select({ id: schema.securitySignal.id })
    .from(schema.securitySignal)
    .where(eq(schema.securitySignal.securityTargetId, securityTargetId))
    .orderBy(asc(schema.securitySignal.detectedAt), asc(schema.securitySignal.id));
  return rows.map((row) => row.id);
}

export interface SecurityOpportunityEvaluationResult {
  securityOpportunityId: string;
  /** Whether this call newly detected the Opportunity (vs. it already existing). */
  detected: boolean;
}

/**
 * Evaluates whether a Security Target's current Intelligence satisfies
 * the (placeholder) Opportunity-detection threshold, and if so, ensures
 * the corresponding (deterministic-ID) Security Opportunity exists —
 * mirrors `evaluateOpportunity` (`packages/scoring/src/opportunity-store.ts`)
 * but only its detection half: there is no scoring step here (see
 * `security-opportunity-detection.ts`'s doc comment), so the created row's
 * `score` stays `null` and its `status` stays `"detected"` — never
 * `"scored"`.
 *
 * Returns `null` if the threshold isn't met — nothing is written at all
 * in that case.
 */
export async function evaluateSecurityOpportunity(
  securityTargetId: string,
  intelligence: SecurityTargetIntelligenceState,
  asOf: Date,
): Promise<SecurityOpportunityEvaluationResult | null> {
  if (!meetsSecurityOpportunityThreshold(intelligence)) {
    return null;
  }

  const opportunityType = ACTIVE_PROTOCOL;
  const detectionWindow = computeSecurityDetectionWindow(asOf);
  const opportunityId = deriveSecurityOpportunityId({
    securityTargetId,
    opportunityType,
    detectionWindow,
  });

  const db = getDb();
  const [existing] = await db
    .select()
    .from(schema.securityOpportunity)
    .where(eq(schema.securityOpportunity.id, opportunityId))
    .limit(1);

  if (existing) {
    return { securityOpportunityId: opportunityId, detected: false };
  }

  const signalIds = await getSecurityTargetSignalIds(securityTargetId);
  const reasoning =
    `Detected: ${intelligence.signalCount} signal(s), confidence ${intelligence.confidence.toFixed(2)}, ` +
    `trend ${intelligence.trend}, within window ${detectionWindow}. Unscored — see ` +
    "security-opportunity-detection.ts's doc comment.";
  const detectedEventId = deriveDeterministicId(
    `web3-hunter:security:opportunity-detected:${opportunityId}`,
  );

  await publishEventSafely({
    id: detectedEventId,
    type: SecurityOpportunityDetected.name,
    metadata: { securityOpportunityId: opportunityId, opportunityType, detectionWindow, reasoning },
    occurredAt: asOf,
    confidence: intelligence.confidence,
    sourceLabel: "security-engine",
    relatedEntityType: "security_target",
    relatedEntityId: securityTargetId,
    provenance: signalIds,
  });

  await createSecurityOpportunity({
    securityTargetId,
    opportunityType,
    detectionWindow,
    reasoning,
    detectedAt: asOf,
  });

  return { securityOpportunityId: opportunityId, detected: true };
}
