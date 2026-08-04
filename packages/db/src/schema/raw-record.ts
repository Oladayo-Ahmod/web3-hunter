import { index, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { id } from "../columns";
import { collector } from "./collector";
import { event } from "./event";

/**
 * An immutable, persisted capture of exactly what a Collector fetched, in
 * the source's native shape — the Raw Record from docs/EVENT_MODEL.md
 * §Event Philosophy. Deduplicated by content hash per Collector: re-fetching
 * identical content is a no-op (see the unique index below), which is what
 * makes reprocessing idempotent.
 *
 * Owned exclusively by `packages/ingestion` — see docs/ARCHITECTURE.md §3
 * and §6. Like `event`, this table is append-only: UPDATE and DELETE are
 * rejected by the same triggers installed in
 * `migrations/0004_revoke_raw_record_mutations.sql`.
 */
export const rawRecord = pgTable(
  "raw_record",
  {
    id: id(),
    collectorId: uuid("collector_id")
      .notNull()
      .references(() => collector.id),
    // SHA-256 of the payload's canonical JSON representation. Identifies
    // "the same fact reported again" independent of key ordering.
    contentHash: text("content_hash").notNull(),
    // The source's own stable identifier for the entity this Raw Record
    // describes (e.g. a Greenhouse job's numeric id), if it has one. Lets
    // the ingestion pipeline correlate multiple captures of "the same
    // underlying thing" over time — e.g. to tell a normalizer whether a
    // Raw Record is the first sighting of something or a change to one
    // already seen — without the normalizer itself doing any I/O. Not
    // every source necessarily has a natural stable ID, hence nullable.
    externalId: text("external_id"),
    payload: jsonb("payload").notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("raw_record_collector_content_hash_key").on(table.collectorId, table.contentHash),
    index("raw_record_collector_id_idx").on(table.collectorId),
    index("raw_record_external_id_idx").on(table.collectorId, table.externalId),
  ],
);

/**
 * The ledger of what the ingestion pipeline has done with each Raw Record —
 * the Raw Record -> Event provenance link. A row here means "this Raw
 * Record has been run through a normalizer"; `eventId` is set if that
 * produced a Canonical Event, and left null if the normalizer determined
 * there was nothing new to publish (e.g. the underlying fact hadn't
 * actually changed). Its existence is what makes re-running the ingestion
 * pipeline over the same Raw Record idempotent — see
 * `packages/ingestion`'s `runIngestionPipeline`.
 *
 * Deliberately a separate table from `raw_record` rather than a mutable
 * column on it: `raw_record` stays a pure, append-only capture of what was
 * fetched, and is never updated after insert, even to attach this
 * bookkeeping.
 */
export const rawRecordIngestion = pgTable("raw_record_ingestion", {
  rawRecordId: uuid("raw_record_id")
    .primaryKey()
    .references(() => rawRecord.id),
  eventId: uuid("event_id").references(() => event.id),
  processedAt: timestamp("processed_at", { withTimezone: true }).notNull().defaultNow(),
});
