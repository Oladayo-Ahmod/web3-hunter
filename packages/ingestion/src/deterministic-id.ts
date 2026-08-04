import { createHash } from "node:crypto";

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
  const digest = createHash("sha256").update(`web3-hunter:ingestion:${rawRecordId}`).digest("hex");

  const timeLow = digest.slice(0, 8);
  const timeMid = digest.slice(8, 12);
  const timeHiAndVersion = `4${digest.slice(13, 16)}`;
  const variantNibble = ((Number.parseInt(digest[16]!, 16) & 0x3) | 0x8).toString(16);
  const clockSeq = `${variantNibble}${digest.slice(17, 20)}`;
  const node = digest.slice(20, 32);

  return `${timeLow}-${timeMid}-${timeHiAndVersion}-${clockSeq}-${node}`;
}
