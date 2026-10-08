import { getDb, schema } from "@web3-hunter/db";
import { eq } from "drizzle-orm";
import type { SecurityIntelligenceTrend } from "./types";

export interface UpsertSecurityTargetIntelligenceInput {
  securityTargetId: string;
  trend: SecurityIntelligenceTrend;
  confidence: number;
  signalCount: number;
  lastSignalAt?: Date | null;
  asOf: Date;
}

/**
 * Writes the current Security Target Intelligence projection row.
 * Deliberately a plain upsert of a caller-supplied state, not a
 * computation: this phase has no Security Signal detectors to derive a
 * state from (see `registry.ts`), so there is nothing to compute yet —
 * mirrors `company-intelligence-store.ts`'s `upsertProjection` only,
 * not its `updateCompanyIntelligence` (which also computes the new
 * state and publishes an Event — both deferred to a later phase).
 */
export async function upsertSecurityTargetIntelligence(
  input: UpsertSecurityTargetIntelligenceInput,
) {
  const db = getDb();
  const [row] = await db
    .insert(schema.securityTargetIntelligence)
    .values({
      securityTargetId: input.securityTargetId,
      trend: input.trend,
      confidence: input.confidence,
      signalCount: input.signalCount,
      lastSignalAt: input.lastSignalAt ?? null,
      asOf: input.asOf,
    })
    .onConflictDoUpdate({
      target: schema.securityTargetIntelligence.securityTargetId,
      set: {
        trend: input.trend,
        confidence: input.confidence,
        signalCount: input.signalCount,
        lastSignalAt: input.lastSignalAt ?? null,
        asOf: input.asOf,
        updatedAt: new Date(),
      },
    })
    .returning();
  return row!;
}

export async function getSecurityTargetIntelligence(securityTargetId: string) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.securityTargetIntelligence)
    .where(eq(schema.securityTargetIntelligence.securityTargetId, securityTargetId))
    .limit(1);
  return row ?? null;
}
