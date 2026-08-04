import { publishEvent, type PublishEventInput } from "@web3-hunter/events";

/**
 * Publishes an Event with a caller-supplied deterministic ID, tolerating
 * the case where it was already published by an earlier, interrupted run
 * — the same crash-retry recovery pattern `packages/ingestion`'s
 * `runIngestionPipeline` uses (see that package's `publishNormalizedEvent`),
 * needed here for the same reason: every Event this package publishes has
 * a deterministic ID derived from stable business inputs, so re-running
 * the Scoring pipeline over already-processed data must recover cleanly
 * rather than fail. Returns only the ID — on the "already published" path
 * there is no full envelope to honestly return without re-fetching it,
 * and no caller in this package needs more than the ID back.
 */
export async function publishEventSafely<TMetadata>(
  input: PublishEventInput<TMetadata> & { id: string },
): Promise<string> {
  try {
    const event = await publishEvent(input);
    return event.id;
  } catch (error) {
    if (error instanceof Error && error.message.includes("already been published")) {
      return input.id;
    }
    throw error;
  }
}
