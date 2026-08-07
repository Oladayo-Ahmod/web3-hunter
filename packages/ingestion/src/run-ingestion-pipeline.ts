import { getDb, schema } from "@web3-hunter/db";
import { publishEvent } from "@web3-hunter/events";
import { and, asc, desc, eq, isNotNull, lt, notExists } from "drizzle-orm";
import { deriveEventId } from "./deterministic-id";
import type { NormalizedEvent, Normalizer } from "./normalizer";

type Db = ReturnType<typeof getDb>;

export interface RunIngestionPipelineInput {
  collectorId: string;
  /**
   * This Collector's own identifier for which tracked entity to process
   * Raw Records for — required per ADR 0002
   * (docs/adr/0002-source-scoped-ingestion.md). `collectorId` alone
   * doesn't distinguish between two companies tracked on the same
   * Collector; omitting this let one company's Raw Records be
   * normalized under another's identity.
   */
  sourceIdentifier: string;
  normalize: Normalizer;
}

export interface IngestionPipelineResult {
  /** How many not-yet-processed Raw Records were found. */
  processed: number;
  /** How many of those produced a Canonical Event. */
  published: number;
  /** How many the normalizer decided had nothing new to publish. */
  skipped: number;
}

/**
 * The reusable heart of the Ingestion Pipeline (docs/ARCHITECTURE.md §2):
 * finds this Collector's not-yet-processed Raw Records, runs the supplied
 * normalizer against each, publishes the resulting Canonical Event, and
 * records the Raw Record → Event link in the provenance ledger
 * (`raw_record_ingestion`). Nothing here is specific to any one source —
 * that's entirely contained in the `normalize` function passed in — which
 * is what lets a future Collector reuse this unchanged.
 *
 * Safe to call repeatedly, including after a crash mid-run: each Event's
 * ID is derived deterministically from its Raw Record's ID (see
 * `./deterministic-id.ts`), so retrying a Raw Record whose Event was
 * already published recovers by looking that Event up instead of
 * publishing a duplicate.
 */
export async function runIngestionPipeline(
  input: RunIngestionPipelineInput,
): Promise<IngestionPipelineResult> {
  const db = getDb();

  const unprocessed = await db
    .select()
    .from(schema.rawRecord)
    .where(
      and(
        eq(schema.rawRecord.collectorId, input.collectorId),
        eq(schema.rawRecord.sourceIdentifier, input.sourceIdentifier),
        notExists(
          db
            .select()
            .from(schema.rawRecordIngestion)
            .where(eq(schema.rawRecordIngestion.rawRecordId, schema.rawRecord.id)),
        ),
      ),
    )
    .orderBy(asc(schema.rawRecord.fetchedAt), asc(schema.rawRecord.id));

  let published = 0;
  let skipped = 0;

  for (const rawRecord of unprocessed) {
    const previousPayload = await findPreviousPayload(db, rawRecord);

    const normalized = input.normalize({
      rawRecordId: rawRecord.id,
      collectorId: rawRecord.collectorId,
      payload: rawRecord.payload,
      fetchedAt: rawRecord.fetchedAt,
      previousPayload,
    });

    if (!normalized) {
      await db
        .insert(schema.rawRecordIngestion)
        .values({ rawRecordId: rawRecord.id, eventId: null })
        .onConflictDoNothing({ target: schema.rawRecordIngestion.rawRecordId });
      skipped += 1;
      continue;
    }

    const eventId = deriveEventId(rawRecord.id);
    const publishedEventId = await publishNormalizedEvent(
      eventId,
      rawRecord.collectorId,
      normalized,
    );

    await db
      .insert(schema.rawRecordIngestion)
      .values({ rawRecordId: rawRecord.id, eventId: publishedEventId })
      .onConflictDoNothing({ target: schema.rawRecordIngestion.rawRecordId });

    published += 1;
  }

  return { processed: unprocessed.length, published, skipped };
}

async function findPreviousPayload(
  db: Db,
  rawRecord: {
    id: string;
    collectorId: string;
    sourceIdentifier: string | null;
    externalId: string | null;
  },
): Promise<unknown | null> {
  // `sourceIdentifier` is only ever null for Raw Records stored before it
  // existed (see ADR 0002's documented assumptions) — every row `runIngestionPipeline`
  // passes here comes from a query already filtered to a specific,
  // non-null `sourceIdentifier`, so this guard should never actually
  // trigger in practice; it exists so the comparison below is
  // well-typed rather than comparing against `string | null`.
  if (!rawRecord.externalId || rawRecord.sourceIdentifier === null) {
    return null;
  }

  const [previous] = await db
    .select({ payload: schema.rawRecord.payload })
    .from(schema.rawRecord)
    .where(
      and(
        eq(schema.rawRecord.collectorId, rawRecord.collectorId),
        eq(schema.rawRecord.sourceIdentifier, rawRecord.sourceIdentifier),
        eq(schema.rawRecord.externalId, rawRecord.externalId),
        // UUIDv7 IDs are time-sortable (see @web3-hunter/db's generateId),
        // so comparing by ID avoids any clock-precision ambiguity a
        // `fetchedAt` comparison could have between two captures taken
        // close together.
        lt(schema.rawRecord.id, rawRecord.id),
      ),
    )
    .orderBy(desc(schema.rawRecord.id))
    .limit(1);

  return previous?.payload ?? null;
}

export interface ReconcileMissingRecordsInput {
  collectorId: string;
  /**
   * This Collector's own identifier for which tracked entity to
   * reconcile — required per ADR 0002
   * (docs/adr/0002-source-scoped-ingestion.md). Without this, "every
   * externalId ever tracked under this Collector" included every other
   * company's still-open roles too, which is exactly what caused this
   * function to reconcile another company's open roles as closed under
   * the wrong identity.
   */
  sourceIdentifier: string;
  /** Every externalId observed in the current poll. */
  currentExternalIds: readonly string[];
  /**
   * Given a previously-tracked externalId that's absent from the current
   * poll and the payload it was last known with, produce the event that
   * represents its disappearance — or `null` to ignore it. Same
   * pure-function contract as `Normalizer`.
   */
  normalizeMissing: (input: {
    externalId: string;
    lastKnownPayload: unknown;
  }) => NormalizedEvent | null;
}

/**
 * The other half of turning "Raw Records" into a complete picture: some
 * facts (a job closing) are represented by *absence* from a poll, not by a
 * new Raw Record. Finds externalIds this Collector has previously tracked
 * that are missing from `currentExternalIds`, and publishes whatever event
 * the supplied `normalizeMissing` function says that represents. Like
 * `runIngestionPipeline`, contains no source-specific knowledge itself.
 */
export async function reconcileMissingRecords(
  input: ReconcileMissingRecordsInput,
): Promise<IngestionPipelineResult> {
  const db = getDb();

  const tracked = await db
    .selectDistinct({ externalId: schema.rawRecord.externalId })
    .from(schema.rawRecord)
    .where(
      and(
        eq(schema.rawRecord.collectorId, input.collectorId),
        eq(schema.rawRecord.sourceIdentifier, input.sourceIdentifier),
        isNotNull(schema.rawRecord.externalId),
      ),
    );

  const currentSet = new Set(input.currentExternalIds);
  const missing = tracked
    .map((row) => row.externalId)
    .filter(
      (externalId): externalId is string => externalId !== null && !currentSet.has(externalId),
    );

  let published = 0;
  let skipped = 0;

  for (const externalId of missing) {
    const [latest] = await db
      .select()
      .from(schema.rawRecord)
      .where(
        and(
          eq(schema.rawRecord.collectorId, input.collectorId),
          eq(schema.rawRecord.sourceIdentifier, input.sourceIdentifier),
          eq(schema.rawRecord.externalId, externalId),
        ),
      )
      .orderBy(desc(schema.rawRecord.id))
      .limit(1);

    if (!latest) {
      continue;
    }

    const normalized = input.normalizeMissing({ externalId, lastKnownPayload: latest.payload });

    if (!normalized) {
      skipped += 1;
      continue;
    }

    // Derived from the last-known Raw Record's ID, not a fresh random ID,
    // so re-running reconciliation on a still-missing externalId recovers
    // the same Event via publishEvent's duplicate rejection instead of
    // publishing a new "closed" event on every poll.
    const eventId = deriveEventId(`${latest.id}:missing`);
    await publishNormalizedEvent(eventId, input.collectorId, normalized);
    published += 1;
  }

  return { processed: missing.length, published, skipped };
}

async function publishNormalizedEvent(
  eventId: string,
  collectorId: string,
  normalized: NonNullable<ReturnType<Normalizer>>,
): Promise<string> {
  try {
    const event = await publishEvent({
      id: eventId,
      type: normalized.type,
      metadata: normalized.metadata,
      occurredAt: normalized.occurredAt,
      confidence: normalized.confidence,
      collectorId,
      relatedEntityType: normalized.relatedEntityType,
      relatedEntityId: normalized.relatedEntityId,
    });
    return event.id;
  } catch (error) {
    if (error instanceof Error && error.message.includes("already been published")) {
      // A retry after a crash between publishing and recording the
      // provenance ledger row — the Event already exists with this
      // deterministic ID; recover by using it rather than failing.
      return eventId;
    }
    throw error;
  }
}
