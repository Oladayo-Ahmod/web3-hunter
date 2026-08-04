export interface NormalizerInput {
  rawRecordId: string;
  collectorId: string;
  payload: unknown;
  fetchedAt: Date;
  /**
   * The payload of the most recently captured Raw Record that shares this
   * one's `externalId` (if it has one and a prior capture exists), or
   * `null` if this is the first sighting. Supplied by
   * `runIngestionPipeline` so a normalizer can tell "new" from "changed"
   * without doing any I/O of its own — see the `Normalizer` type below.
   */
  previousPayload: unknown | null;
}

export interface NormalizedEvent<TMetadata = unknown> {
  type: string;
  metadata: TMetadata;
  occurredAt: Date;
  confidence: number;
  relatedEntityType?: string;
  relatedEntityId?: string;
}

/**
 * A source-specific transform from a Raw Record's payload to the Canonical
 * Event it represents — supplied by each Collector, never written in this
 * package. Returning `null` means "this Raw Record doesn't represent a new
 * fact worth publishing," which is a legitimate outcome, not an error
 * (e.g. a re-fetch whose content hash changed for a reason this normalizer
 * doesn't consider meaningful).
 *
 * Deliberately synchronous and side-effect free: no I/O, no dependency on
 * `@web3-hunter/db` or `@web3-hunter/events`. This is what keeps a
 * normalizer trivially unit-testable in isolation, and what makes
 * `runIngestionPipeline` reusable across every Collector unchanged — it
 * only ever calls the function it's given.
 */
export type Normalizer<TMetadata = unknown> = (
  input: NormalizerInput,
) => NormalizedEvent<TMetadata> | null;
