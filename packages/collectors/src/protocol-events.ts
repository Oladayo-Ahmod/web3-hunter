import { registerEventType, type NormalizedEvent, type Normalizer } from "@web3-hunter/ingestion";
import { z } from "zod";

/**
 * The canonical protocol-facts vocabulary a Security-intelligence
 * Collector normalizes into — `ProtocolSnapshotRecorded`/
 * `ProtocolSnapshotUpdated`, with one shared `ProtocolFields` shape.
 * Mirrors `./repository-events.ts`'s role for VCS Collectors: the event
 * types are registered once, here, shared — never per-Collector — so a
 * future second protocol-intelligence source would normalize into this
 * same canonical shape rather than inventing its own.
 *
 * There is no `ProtocolDelisted` counterpart yet: DefiLlama's `/protocols`
 * endpoint is a current-snapshot dump, not a changelog, and a protocol
 * disappearing from it is out of scope for this Collector — see
 * `apps/web/lib/collectors/run-defillama.ts`'s doc comment.
 */

const protocolFieldsSchema = z.object({
  slug: z.string(),
  name: z.string(),
  category: z.string().nullable(),
  // DefiLlama's reported Total Value Locked, in USD. `null` when
  // DefiLlama itself reports no TVL for this protocol.
  tvl: z.number().nullable(),
  change1d: z.number().nullable(),
  change7d: z.number().nullable(),
  // Unix seconds — DefiLlama's own "when we started tracking this" fact,
  // not necessarily this protocol's true launch date. See
  // `packages/security/src/detectors/defillama-detectors.ts`'s
  // `newProtocolDetector` doc comment for why this is never conflated
  // with "first observed by our own poll history."
  listedAt: z.number().nullable(),
  // DefiLlama's own audit count, reported as a string (e.g. "0", "2") —
  // reflects what the project submitted to DefiLlama's listing, not an
  // independent audit registry. See `auditCoverageGapDetector`'s doc
  // comment for why this is only ever a weak negative signal.
  audits: z.string().nullable(),
  auditLinks: z.array(z.string()),
  chains: z.array(z.string()),
});

export type ProtocolFields = z.infer<typeof protocolFieldsSchema>;

const protocolSnapshotRecordedMetadataSchema = protocolFieldsSchema;
const protocolSnapshotUpdatedMetadataSchema = protocolFieldsSchema.extend({
  changedFrom: protocolFieldsSchema.partial(),
});

export const ProtocolSnapshotRecorded = registerEventType({
  name: "ProtocolSnapshotRecorded",
  category: "source",
  version: 1,
  metadataSchema: protocolSnapshotRecordedMetadataSchema,
});

export const ProtocolSnapshotUpdated = registerEventType({
  name: "ProtocolSnapshotUpdated",
  category: "source",
  version: 1,
  metadataSchema: protocolSnapshotUpdatedMetadataSchema,
});

/** A source payload mapped to the canonical shape — the one thing a protocol-data Collector's normalizer supplies. */
export interface CanonicalProtocol {
  fields: ProtocolFields;
}

function diffProtocolFields(
  current: ProtocolFields,
  previous: ProtocolFields,
): Partial<ProtocolFields> {
  const changedFrom: Partial<ProtocolFields> = {};

  for (const key of Object.keys(current) as (keyof ProtocolFields)[]) {
    if (JSON.stringify(current[key]) !== JSON.stringify(previous[key])) {
      (changedFrom as Record<string, unknown>)[key] = previous[key];
    }
  }

  return changedFrom;
}

/**
 * Builds a protocol-data Collector's normalizer for one Security Target.
 * Pure and synchronous, per `Normalizer`'s contract.
 *
 * Unlike `createRepositoryNormalizer`, `occurredAt` is always
 * `input.fetchedAt` — DefiLlama's `/protocols` response carries no
 * per-protocol "last changed" timestamp (see `ProtocolFields.listedAt`'s
 * doc comment for the one timestamp it does carry, and why it is a
 * different fact entirely). The honest timestamp for "when we learned
 * this" is when we polled it, not DefiLlama's own, unrelated `listedAt`.
 */
export function createProtocolNormalizer(
  securityTargetId: string,
  toCanonicalProtocol: (payload: unknown) => CanonicalProtocol,
): Normalizer {
  return (input) => {
    const current = toCanonicalProtocol(input.payload);

    if (!input.previousPayload) {
      const event: NormalizedEvent = {
        type: ProtocolSnapshotRecorded.name,
        metadata: current.fields,
        occurredAt: input.fetchedAt,
        confidence: 1,
        relatedEntityType: "security_target",
        relatedEntityId: securityTargetId,
      };
      return event;
    }

    const previous = toCanonicalProtocol(input.previousPayload);
    const changedFrom = diffProtocolFields(current.fields, previous.fields);

    if (Object.keys(changedFrom).length === 0) {
      return null;
    }

    const event: NormalizedEvent = {
      type: ProtocolSnapshotUpdated.name,
      metadata: { ...current.fields, changedFrom },
      occurredAt: input.fetchedAt,
      confidence: 1,
      relatedEntityType: "security_target",
      relatedEntityId: securityTargetId,
    };
    return event;
  };
}
