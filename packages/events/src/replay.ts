import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import { getDb, schema } from "@web3-hunter/db";
import type { EventCategory } from "./categories";
import { eventEnvelopeSchema, type EventEnvelope } from "./envelope";

export interface ReplayFilter {
  collectorId?: string;
  type?: string;
  category?: EventCategory;
  occurredFrom?: Date;
  occurredTo?: Date;
}

/**
 * Reads events back in a stable, deterministic order — by when they
 * occurred, then when they were recorded, then by ID (itself time-sortable,
 * see `@web3-hunter/db`'s `generateId`), so ties never resolve differently
 * between runs. Replaying the same filter against the same data always
 * produces the same sequence, per docs/EVENT_MODEL.md §Event Rules
 * ("Replay must be idempotent").
 *
 * This function — not `@web3-hunter/db` — owns what "replay" means:
 * `packages/db` only exposes the generic schema and query client this is
 * built on top of. See docs/ARCHITECTURE.md §3.
 */
export async function replayEvents(filter: ReplayFilter = {}): Promise<EventEnvelope[]> {
  const conditions = [];
  if (filter.collectorId !== undefined) {
    conditions.push(eq(schema.event.collectorId, filter.collectorId));
  }
  if (filter.type !== undefined) {
    conditions.push(eq(schema.event.type, filter.type));
  }
  if (filter.category !== undefined) {
    conditions.push(eq(schema.event.category, filter.category));
  }
  if (filter.occurredFrom !== undefined) {
    conditions.push(gte(schema.event.occurredAt, filter.occurredFrom));
  }
  if (filter.occurredTo !== undefined) {
    conditions.push(lte(schema.event.occurredAt, filter.occurredTo));
  }

  const rows = await getDb()
    .select()
    .from(schema.event)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(asc(schema.event.occurredAt), asc(schema.event.recordedAt), asc(schema.event.id));

  if (rows.length === 0) {
    return [];
  }

  const provenanceRows = await getDb()
    .select()
    .from(schema.eventProvenance)
    .where(
      inArray(
        schema.eventProvenance.eventId,
        rows.map((row) => row.id),
      ),
    )
    .orderBy(asc(schema.eventProvenance.causedByEventId));

  const provenanceByEventId = new Map<string, string[]>();
  for (const row of provenanceRows) {
    const existing = provenanceByEventId.get(row.eventId);
    if (existing) {
      existing.push(row.causedByEventId);
    } else {
      provenanceByEventId.set(row.eventId, [row.causedByEventId]);
    }
  }

  return rows.map((row) =>
    eventEnvelopeSchema.parse({
      ...row,
      provenance: provenanceByEventId.get(row.id) ?? [],
    }),
  );
}
