import { getDb, schema } from "@web3-hunter/db";
import { eq } from "drizzle-orm";
import { deriveSecurityOpportunityId } from "./opportunity-id";

export interface CreateSecurityOpportunityInput {
  securityTargetId: string;
  opportunityType: string;
  detectionWindow: string;
  reasoning: string;
  detectedAt: Date;
}

/**
 * Idempotently resolves a Security Opportunity by its deterministic id
 * — mirrors the "insert, or fetch the row that already exists" pattern
 * `createSecurityTarget` uses, so replaying the same
 * `(securityTargetId, opportunityType, detectionWindow)` never creates
 * a duplicate. Deliberately does not evaluate a confidence threshold or
 * publish an Event — this phase has no Security Intelligence to
 * evaluate against (see `security-target-intelligence-store.ts`); a
 * caller supplies the already-decided facts.
 */
export async function createSecurityOpportunity(input: CreateSecurityOpportunityInput) {
  const db = getDb();
  const id = deriveSecurityOpportunityId(input);

  const [inserted] = await db
    .insert(schema.securityOpportunity)
    .values({
      id,
      securityTargetId: input.securityTargetId,
      opportunityType: input.opportunityType,
      detectionWindow: input.detectionWindow,
      reasoning: input.reasoning,
      detectedAt: input.detectedAt,
    })
    .onConflictDoNothing({ target: schema.securityOpportunity.id })
    .returning();

  if (inserted) {
    return inserted;
  }

  const existing = await getSecurityOpportunity(id);
  if (!existing) {
    throw new Error(`Failed to resolve Security Opportunity "${id}".`);
  }
  return existing;
}

export async function getSecurityOpportunity(id: string) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.securityOpportunity)
    .where(eq(schema.securityOpportunity.id, id))
    .limit(1);
  return row ?? null;
}
