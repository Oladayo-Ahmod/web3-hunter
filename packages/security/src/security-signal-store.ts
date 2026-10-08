import { getDb, schema } from "@web3-hunter/db";
import { eq } from "drizzle-orm";

export interface PersistSecuritySignalInput {
  securityTargetId: string;
  signalType: string;
  weight: number;
  reasoning: string;
  sourceEventIds: readonly string[];
  detectedAt: Date;
}

/**
 * Persists a Security Signal — a plain, direct insert. Unlike
 * `persistSignal` (`packages/scoring/src/signal-generation.ts`), this
 * does not derive a deterministic id from a triggering Event and does
 * not publish an Event of its own: no `SecuritySignalDetected`-equivalent
 * Event Type is registered yet (see `security_signal`'s schema doc
 * comment), so there is nothing to derive from or publish alongside.
 */
export async function persistSecuritySignal(input: PersistSecuritySignalInput) {
  const db = getDb();
  const [row] = await db
    .insert(schema.securitySignal)
    .values({
      securityTargetId: input.securityTargetId,
      signalType: input.signalType,
      weight: input.weight,
      reasoning: input.reasoning,
      sourceEventIds: [...input.sourceEventIds],
      detectedAt: input.detectedAt,
    })
    .returning();
  return row!;
}

export async function listSecuritySignalsForTarget(securityTargetId: string) {
  const db = getDb();
  return db
    .select()
    .from(schema.securitySignal)
    .where(eq(schema.securitySignal.securityTargetId, securityTargetId));
}
