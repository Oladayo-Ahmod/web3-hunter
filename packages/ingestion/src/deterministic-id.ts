import { deriveDeterministicId } from "@web3-hunter/shared";

/**
 * Derives a stable, UUID-formatted identifier from a Raw Record's ID, for
 * use as the Canonical Event's ID when normalizing it. This is what makes
 * `runIngestionPipeline` safe to retry after a crash between publishing an
 * Event and recording that fact in the provenance ledger (see
 * `run-ingestion-pipeline.ts`): retrying computes the *same* Event ID,
 * hits `publishEvent`'s existing duplicate-ID rejection instead of
 * creating a second Event for the same Raw Record, and the retry can
 * recover by looking that Event up instead of failing.
 */
export function deriveEventId(rawRecordId: string): string {
  return deriveDeterministicId(`web3-hunter:ingestion:${rawRecordId}`);
}
