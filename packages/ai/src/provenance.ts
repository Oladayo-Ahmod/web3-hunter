import { getDb, schema } from "@web3-hunter/db";
import { and, desc, eq, sql } from "drizzle-orm";

/**
 * Finds the most recently recorded Event of `type` for a given related
 * entity whose `metadata[metadataKey]` matches `metadataValue` — the
 * real Event an AI-generated Event cites as provenance, since a
 * `recommendation`/`opportunity`/`company_intelligence`/`match` row is a
 * mutable projection, not an Event itself. The same pattern
 * `packages/decision`'s `findRecommendationProvenance` uses, duplicated
 * here rather than imported: `packages/ai` never depends on
 * `packages/decision`, `packages/scoring`, or `packages/matching`
 * internals.
 */
export async function findLatestEventId(input: {
  type: string;
  relatedEntityType: string;
  relatedEntityId: string;
  metadataKey: string;
  metadataValue: string;
}): Promise<string | null> {
  const [row] = await getDb()
    .select({ id: schema.event.id })
    .from(schema.event)
    .where(
      and(
        eq(schema.event.type, input.type),
        eq(schema.event.relatedEntityType, input.relatedEntityType),
        eq(schema.event.relatedEntityId, input.relatedEntityId),
        sql`${schema.event.metadata} ->> ${input.metadataKey} = ${input.metadataValue}`,
      ),
    )
    .orderBy(desc(schema.event.recordedAt))
    .limit(1);

  return row?.id ?? null;
}

/** The most recent Event of `type` for a related entity, with no metadata filter — used when the artifact is about the entity as a whole (e.g. a Company Summary), not a specific child record. */
export async function findLatestEventIdForEntity(input: {
  type: string;
  relatedEntityType: string;
  relatedEntityId: string;
}): Promise<string | null> {
  const [row] = await getDb()
    .select({ id: schema.event.id })
    .from(schema.event)
    .where(
      and(
        eq(schema.event.type, input.type),
        eq(schema.event.relatedEntityType, input.relatedEntityType),
        eq(schema.event.relatedEntityId, input.relatedEntityId),
      ),
    )
    .orderBy(desc(schema.event.recordedAt))
    .limit(1);

  return row?.id ?? null;
}
