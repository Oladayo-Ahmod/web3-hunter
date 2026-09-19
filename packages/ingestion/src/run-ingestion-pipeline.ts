import { getDb, schema } from "@web3-hunter/db";
import { publishEvent } from "@web3-hunter/events";
import { and, asc, desc, eq, inArray, isNotNull, lt, notExists } from "drizzle-orm";
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
 *
 * Only reads what it needs (Supabase egress fix — the quota was exhausted
 * at 12.35 GB in ~3 weeks). Every run used to re-download *every stored
 * version* of *every job that had ever closed* at this source — payloads
 * with full job descriptions — only to re-derive an already-published
 * close event and have `publishEvent` reject it as a duplicate. That set
 * only grows: a job stays "missing" forever once closed. Now:
 *
 * 1. One ids-only query returns the latest Raw Record ID per externalId.
 * 2. The close event's ID is deterministic (`deriveEventId` of that Raw
 *    Record's ID), so one ids-only `event` lookup shows which closes were
 *    already published.
 * 3. Payloads are fetched only for jobs that still need a close event.
 *
 * The events that end up published are identical to before — an
 * already-published close was a no-op — so replay/idempotency are
 * unchanged. Two visible differences: `published` now counts only newly
 * closed jobs (it used to also count every re-attempted duplicate, which
 * inflated the Collector's per-run `closed` figure), and a `normalizeMissing`
 * that returns `null` for a job is retried on the next run, as before.
 */
export async function reconcileMissingRecords(
  input: ReconcileMissingRecordsInput,
): Promise<IngestionPipelineResult> {
  const db = getDb();

  const tracked = await db
    .selectDistinctOn([schema.rawRecord.externalId], {
      id: schema.rawRecord.id,
      externalId: schema.rawRecord.externalId,
    })
    .from(schema.rawRecord)
    .where(
      and(
        eq(schema.rawRecord.collectorId, input.collectorId),
        eq(schema.rawRecord.sourceIdentifier, input.sourceIdentifier),
        isNotNull(schema.rawRecord.externalId),
      ),
    )
    // UUIDv7 IDs are time-sortable, so the highest ID per externalId is its
    // most recent capture — the same "latest" `findPreviousPayload` uses.
    .orderBy(schema.rawRecord.externalId, desc(schema.rawRecord.id));

  const currentSet = new Set(input.currentExternalIds);
  const missing = tracked.flatMap((row) =>
    row.externalId !== null && !currentSet.has(row.externalId)
      ? [
          {
            externalId: row.externalId,
            latestRawRecordId: row.id,
            // Derived from the last-known Raw Record's ID, not a fresh random
            // ID, so re-running reconciliation on a still-missing externalId
            // recovers the same Event instead of publishing a new "closed"
            // event on every poll.
            eventId: deriveEventId(`${row.id}:missing`),
          },
        ]
      : [],
  );

  if (missing.length === 0) {
    return { processed: 0, published: 0, skipped: 0 };
  }

  const alreadyClosedEventIds = new Set(
    (
      await db
        .select({ id: schema.event.id })
        .from(schema.event)
        .where(
          inArray(
            schema.event.id,
            missing.map((item) => item.eventId),
          ),
        )
    ).map((row) => row.id),
  );
  const needsCloseEvent = missing.filter((item) => !alreadyClosedEventIds.has(item.eventId));

  if (needsCloseEvent.length === 0) {
    return { processed: missing.length, published: 0, skipped: 0 };
  }

  const payloadRows = await db
    .select({ id: schema.rawRecord.id, payload: schema.rawRecord.payload })
    .from(schema.rawRecord)
    .where(
      inArray(
        schema.rawRecord.id,
        needsCloseEvent.map((item) => item.latestRawRecordId),
      ),
    );
  const payloadByRawRecordId = new Map(payloadRows.map((row) => [row.id, row.payload]));

  let published = 0;
  let skipped = 0;

  for (const item of needsCloseEvent) {
    if (!payloadByRawRecordId.has(item.latestRawRecordId)) {
      continue;
    }

    const normalized = input.normalizeMissing({
      externalId: item.externalId,
      lastKnownPayload: payloadByRawRecordId.get(item.latestRawRecordId),
    });

    if (!normalized) {
      skipped += 1;
      continue;
    }

    await publishNormalizedEvent(item.eventId, input.collectorId, normalized);
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
