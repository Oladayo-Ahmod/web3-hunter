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

  // Defense-in-depth for the assumption ADR 0002
  // (docs/adr/0002-source-scoped-ingestion.md) documents rather than
  // enforces: that two different sources never produce a byte-identical
  // payload, because every source's own payload embeds
  // identifying data (a URL, an org name) that would itself have to
  // coincidentally match too. Under normal operation this can never
  // trigger — content_hash covers the entire payload, so re-polling the
  // *same* board always supplies the *same* sourceIdentifier as the
  // original insert. If it ever does trigger, the assumption was wrong;
  // failing loudly here is safer than silently handing back a Raw Record
  // attributed to the wrong source.
  //
  // Deliberately excludes `existing.sourceIdentifier === null`: that's
  // not a collision between two sources, it's a Raw Record captured
  // before this column existed (see ADR 0002's documented assumption
  // that historical data isn't repaired by this change). Discovered
  // live: content unchanged since before the migration re-hits this
  // exact conflict path on every future run for that entity, which
  // would otherwise permanently and repeatedly fail every subsequent
  // `collect:*` run for any company with any pre-migration data —
  // exactly the "silently ignore it going forward" behavior already
  // documented and tested for the read side (`findPreviousPayload`,
  // `runIngestionPipeline`'s unprocessed-select) needs to hold here too.
  if (existing.sourceIdentifier !== null && existing.sourceIdentifier !== input.sourceIdentifier) {
    throw new Error(
      `storeRawRecord: a Raw Record with this exact content already exists under a ` +
        `different sourceIdentifier ("${existing.sourceIdentifier}" vs "${input.sourceIdentifier}") ` +
        `for collector "${input.collectorId}". This should be structurally impossible — see ` +
        `docs/adr/0002-source-scoped-ingestion.md's documented cross-source collision assumption.`,
    );
  }

  return existing;
}
