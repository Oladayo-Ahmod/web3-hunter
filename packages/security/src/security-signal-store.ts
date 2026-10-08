import { getDb, schema } from "@web3-hunter/db";
import { eq } from "drizzle-orm";

export interface PersistSecuritySignalInput {
  /**
   * Optional explicit id. `recordSecuritySignal`
   * (`./security-signal-generation.ts`) passes a deterministic id derived
   * from the triggering Event, so replaying the same history recovers the
   * same Signal instead of duplicating it. Omitted, the column's own
   * default (a generated UUIDv7) applies — the original Phase 1 behavior,
   * still exercised by callers with no triggering Event to derive from.
   */
  id?: string;
  securityTargetId: string;
  signalType: string;
  weight: number;
  reasoning: string;
  sourceEventIds: readonly string[];
  detectedAt: Date;
}

/**
 * Persists a Security Signal — a plain, direct insert. Deriving a
 * deterministic id and publishing a `SecuritySignalDetected` Event
 * alongside it is the caller's job (`recordSecuritySignal`), not this
 * function's — this stays the single, narrow "write the row" primitive
 * both that orchestration and any future direct writer (e.g. a Signal
 * sourced from a human-curated fact, with no triggering Event at all)
 * can share.
 */
export async function persistSecuritySignal(input: PersistSecuritySignalInput) {
  const db = getDb();
  const [row] = await db
    .insert(schema.securitySignal)
    .values({
      ...(input.id ? { id: input.id } : {}),
      securityTargetId: input.securityTargetId,
      signalType: input.signalType,
      weight: input.weight,
      reasoning: input.reasoning,
      sourceEventIds: [...input.sourceEventIds],
      detectedAt: input.detectedAt,
    })
    .onConflictDoNothing({ target: schema.securitySignal.id })
    .returning();

  if (row) {
    return row;
  }

  if (!input.id) {
    throw new Error(
      "persistSecuritySignal: insert was skipped as a duplicate with no id to recover by.",
    );
  }

  const [existing] = await db
    .select()
    .from(schema.securitySignal)
    .where(eq(schema.securitySignal.id, input.id))
    .limit(1);

  if (!existing) {
    throw new Error(`Failed to resolve Security Signal "${input.id}".`);
  }

  return existing;
}

export async function listSecuritySignalsForTarget(securityTargetId: string) {
  const db = getDb();
  return db
    .select()
    .from(schema.securitySignal)
    .where(eq(schema.securitySignal.securityTargetId, securityTargetId));
}
