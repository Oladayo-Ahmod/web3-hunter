import { generateId, getDb, schema } from "@web3-hunter/db";
import { eventEnvelopeSchema, type EventEnvelope } from "./envelope";
import { getEventType } from "./registry";

export interface PublishEventInput<TMetadata> {
  type: string;
  occurredAt: Date;
  confidence: number;
  metadata: TMetadata;
  /**
   * Overrides the generated Event ID. Only meaningful for idempotent
   * retries — a Collector that isn't sure whether its previous publish
   * attempt succeeded can safely retry with the same ID: the database's
   * primary key rejects the duplicate rather than creating a second copy
   * of the same fact (see docs/EVENT_MODEL.md §Event Rules — "Replay must
   * be idempotent"). Defaults to a fresh, time-sortable ID.
   */
  id?: string;
  collectorId?: string;
  sourceLabel?: string;
  relatedEntityType?: string;
  relatedEntityId?: string;
  provenance?: readonly string[];
}

const POSTGRES_UNIQUE_VIOLATION = "23505";

function isUniqueViolation(error: unknown): boolean {
  const cause = error instanceof Error ? (error.cause ?? error) : error;
  return (
    typeof cause === "object" &&
    cause !== null &&
    "code" in cause &&
    (cause as { code: unknown }).code === POSTGRES_UNIQUE_VIOLATION
  );
}

/**
 * Validates an event against its registered type, then persists it —
 * atomically with its provenance links, if it has any. This is the only
 * way an event should ever be written; nothing outside this function
 * inserts into the `event` table.
 */
export async function publishEvent<TMetadata>(
  input: PublishEventInput<TMetadata>,
): Promise<EventEnvelope<TMetadata>> {
  const definition = getEventType(input.type);

  if (!definition) {
    throw new Error(
      `Cannot publish unknown event type "${input.type}". Register it first via ` +
        "registerEventType() — see @web3-hunter/events.",
    );
  }

  const metadata = definition.metadataSchema.parse(input.metadata);

  const envelope = eventEnvelopeSchema.parse({
    id: input.id ?? generateId(),
    type: definition.name,
    category: definition.category,
    version: definition.version,
    collectorId: input.collectorId ?? null,
    sourceLabel: input.sourceLabel ?? null,
    occurredAt: input.occurredAt,
    recordedAt: new Date(),
    relatedEntityType: input.relatedEntityType ?? null,
    relatedEntityId: input.relatedEntityId ?? null,
    provenance: input.provenance ? [...input.provenance] : [],
    confidence: input.confidence,
    metadata,
  });

  try {
    await getDb().transaction(async (tx) => {
      await tx.insert(schema.event).values({
        id: envelope.id,
        type: envelope.type,
        category: envelope.category,
        version: envelope.version,
        collectorId: envelope.collectorId,
        sourceLabel: envelope.sourceLabel,
        occurredAt: envelope.occurredAt,
        recordedAt: envelope.recordedAt,
        relatedEntityType: envelope.relatedEntityType,
        relatedEntityId: envelope.relatedEntityId,
        confidence: envelope.confidence,
        metadata: envelope.metadata,
      });

      if (envelope.provenance.length > 0) {
        await tx.insert(schema.eventProvenance).values(
          envelope.provenance.map((causedByEventId) => ({
            eventId: envelope.id,
            causedByEventId,
          })),
        );
      }
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new Error(
        `Event with id "${envelope.id}" has already been published. Publishing is ` +
          "idempotent by design — see PublishEventInput.id — but this ID collided with " +
          "an existing event that was not identical, or was published as a genuine retry.",
        { cause: error },
      );
    }
    throw error;
  }

  return { ...envelope, metadata } as EventEnvelope<TMetadata>;
}
