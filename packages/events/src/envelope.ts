import { z } from "zod";
import { EVENT_CATEGORIES } from "./categories";

const baseEventEnvelopeSchema = z.object({
  id: z.string().uuid(),
  type: z.string().min(1),
  category: z.enum(EVENT_CATEGORIES),
  version: z.number().int().positive(),
  // Source: for a "source" category event, the Collector that produced it;
  // for every other category, a label identifying the producing subsystem
  // instead. Exactly one is set — see docs/DOMAIN_MODEL.md §Collector and
  // docs/EVENT_MODEL.md §Event Structure ("Source").
  collectorId: z.string().uuid().nullable(),
  sourceLabel: z.string().min(1).nullable(),
  occurredAt: z.date(),
  recordedAt: z.date(),
  relatedEntityType: z.string().min(1).nullable(),
  relatedEntityId: z.string().uuid().nullable(),
  // The Event IDs this (derived) event cites as its evidence. Empty for
  // Source Events, required for every other category — see
  // docs/DOMAIN_MODEL.md Domain Rule #1.
  provenance: z.array(z.string().uuid()),
  confidence: z.number().min(0).max(1),
  metadata: z.unknown(),
});

/**
 * The canonical, closed, immutable Event envelope shape — matching
 * docs/EVENT_MODEL.md §Event Structure field-for-field. This schema
 * itself never changes as new Event Types are added; only the registry
 * (./registry.ts) grows.
 */
export const eventEnvelopeSchema = baseEventEnvelopeSchema
  .refine((envelope) => (envelope.collectorId !== null) !== (envelope.sourceLabel !== null), {
    message:
      'Exactly one of "collectorId" or "sourceLabel" must be set — see docs/DOMAIN_MODEL.md §Collector.',
    path: ["collectorId"],
  })
  .refine((envelope) => (envelope.collectorId !== null) === (envelope.category === "source"), {
    message: '"collectorId" must be set if and only if category is "source".',
    path: ["category"],
  })
  .refine(
    (envelope) => (envelope.relatedEntityType === null) === (envelope.relatedEntityId === null),
    {
      message: '"relatedEntityType" and "relatedEntityId" must both be set or both be null.',
      path: ["relatedEntityType"],
    },
  )
  .refine(
    (envelope) =>
      envelope.category === "source"
        ? envelope.provenance.length === 0
        : envelope.provenance.length > 0,
    {
      message:
        'A "source" event must have empty provenance; every other category must cite at ' +
        "least one upstream event as provenance — see docs/EVENT_MODEL.md §Event Structure " +
        "and docs/DOMAIN_MODEL.md Domain Rule #1.",
      path: ["provenance"],
    },
  );

export type EventEnvelope<TMetadata = unknown> = Omit<
  z.infer<typeof baseEventEnvelopeSchema>,
  "metadata"
> & {
  metadata: TMetadata;
};
