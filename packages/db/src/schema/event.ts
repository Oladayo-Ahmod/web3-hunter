import { sql } from "drizzle-orm";
import {
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { id } from "../columns";
import { collector } from "./collector";

/**
 * The seven-category taxonomy from docs/EVENT_MODEL.md §Event Categories.
 * Unlike an Event's `type` (below), these categories are a
 * stable, closed taxonomy — adding an eighth category is an architectural
 * change to the event model itself, not a routine addition — so this is a
 * native Postgres enum, per docs/DATABASE.md §4 ("Enums").
 */
export const eventCategory = pgEnum("event_category", [
  "source",
  "intelligence",
  "decision",
  "recommendation",
  "application",
  "user",
  "notification",
]);

/**
 * The canonical, append-only event log — the one Canonical data store in
 * this system, per docs/DATABASE.md §1 and §2. Every field here mirrors
 * docs/EVENT_MODEL.md §Event Structure exactly.
 *
 * `type` is deliberately TEXT, not a Postgres enum: per the approved
 * refinement to this milestone, the Event *type* vocabulary must stay open
 * for extension (a new Collector or engine registers a new type without
 * anyone editing a shared enum), while the *envelope* — this table's
 * columns — stays closed and immutable. The closed, canonical set of valid
 * type names is enforced in application code by the registry in
 * `@web3-hunter/events`, not by the database — see that package's
 * `registry.ts`.
 *
 * This table is append-only: UPDATE and DELETE are rejected by triggers
 * installed in a dedicated migration (see
 * `migrations/0002_revoke_event_mutations.sql`), per
 * docs/EVENT_MODEL.md §Event Rules ("Events are immutable").
 */
export const event = pgTable(
  "event",
  {
    id: id(),
    type: text("type").notNull(),
    category: eventCategory("category").notNull(),
    version: integer("version").notNull(),

    // Source: for a "source" category event, the Collector that produced
    // it; for every other category, a label identifying the producing
    // subsystem instead. Exactly one of the two is set — see the check
    // constraint below and docs/DOMAIN_MODEL.md §Collector's invariant.
    collectorId: uuid("collector_id").references(() => collector.id),
    sourceLabel: text("source_label"),

    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),

    relatedEntityType: text("related_entity_type"),
    relatedEntityId: uuid("related_entity_id"),

    confidence: doublePrecision("confidence").notNull(),

    metadata: jsonb("metadata").notNull(),
  },
  (table) => [
    check("event_confidence_range", sql`${table.confidence} >= 0 AND ${table.confidence} <= 1`),
    check(
      "event_source_exclusivity",
      sql`(${table.collectorId} IS NOT NULL) <> (${table.sourceLabel} IS NOT NULL)`,
    ),
    check(
      "event_related_entity_pair",
      sql`(${table.relatedEntityType} IS NULL) = (${table.relatedEntityId} IS NULL)`,
    ),
    index("event_type_idx").on(table.type),
    index("event_category_idx").on(table.category),
    index("event_collector_id_idx").on(table.collectorId),
    index("event_occurred_at_idx").on(table.occurredAt),
    index("event_related_entity_idx").on(table.relatedEntityType, table.relatedEntityId),
  ],
);

/**
 * Provenance: which upstream Events a derived Event cites as its evidence,
 * per docs/EVENT_MODEL.md §Event Structure ("Provenance") and
 * docs/DOMAIN_MODEL.md Domain Rule #1. A join table rather than an array
 * column deliberately — see docs/ARCHITECTURE.md and this milestone's
 * trade-off notes: it keeps each causal link a real, indexable,
 * foreign-keyed row in both directions, at the cost of one extra insert
 * per cited event.
 */
export const eventProvenance = pgTable(
  "event_provenance",
  {
    eventId: uuid("event_id")
      .notNull()
      .references(() => event.id),
    causedByEventId: uuid("caused_by_event_id")
      .notNull()
      .references(() => event.id),
  },
  (table) => [
    primaryKey({ columns: [table.eventId, table.causedByEventId] }),
    index("event_provenance_caused_by_event_id_idx").on(table.causedByEventId),
  ],
);
