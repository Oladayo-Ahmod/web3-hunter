import { getDb, schema } from "@web3-hunter/db";
import { and, eq } from "drizzle-orm";
import { hashContent } from "./content-hash";

export interface RawRecord {
  id: string;
  collectorId: string;
  contentHash: string;
  externalId: string | null;
  sourceIdentifier: string | null;
  payload: unknown;
  fetchedAt: Date;
}

export interface StoreRawRecordInput {
  collectorId: string;
  payload: unknown;
  /** The source's own stable ID for this entity, if it has one — see docs/DATABASE.md and `raw_record.externalId`. */
  externalId?: string;
  /**
   * This Collector's own identifier for which tracked entity this record
   * came from — a Greenhouse board token, a Lever site, a GitHub org
   * login. Required, not optional: per ADR 0002
   * (docs/adr/0002-source-scoped-ingestion.md), omitting it is meant to
   * be a compile-time error, not a silent reversion to the
   * collector-only scoping that caused cross-company misattribution.
   */
  sourceIdentifier: string;
}

/**
 * Persists a Raw Record immutably, deduplicated by content hash within its
 * Collector: if this exact payload has already been captured, the
 * existing row is returned rather than a duplicate being created. This is
 * the "reprocessing the same Raw Record is idempotent" guarantee at the
 * capture level — see docs/EVENT_MODEL.md's Raw Record definition.
 */
export async function storeRawRecord(input: StoreRawRecordInput): Promise<RawRecord> {
  const contentHash = hashContent(input.payload);
  const db = getDb();

  const [inserted] = await db
    .insert(schema.rawRecord)
    .values({
      collectorId: input.collectorId,
      contentHash,
      externalId: input.externalId ?? null,
      sourceIdentifier: input.sourceIdentifier,
      payload: input.payload,
    })
    .onConflictDoNothing({
      target: [schema.rawRecord.collectorId, schema.rawRecord.contentHash],
    })
    .returning();

  if (inserted) {
    return inserted;
  }

  const [existing] = await db
    .select()
    .from(schema.rawRecord)
    .where(
      and(
        eq(schema.rawRecord.collectorId, input.collectorId),
        eq(schema.rawRecord.contentHash, contentHash),
      ),
    )
    .limit(1);

  if (!existing) {
    throw new Error(
      "storeRawRecord: the insert was skipped as a duplicate, but the existing row could " +
        "not be found afterward. This indicates a concurrent delete, which should be " +
        "impossible against an append-only table.",
    );
  }

  return existing;
}
