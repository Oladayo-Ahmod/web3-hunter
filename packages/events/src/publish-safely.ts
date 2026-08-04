import { publishEvent, type PublishEventInput } from "./publish";

/**
 * Publishes an Event with a caller-supplied deterministic ID, tolerating
 * the case where it was already published by an earlier, interrupted run
 * — the crash-retry recovery pattern every event-sourced package in this
 * system (`packages/ingestion`, `packages/scoring`, `packages/classification`,
 * `packages/matching`) needs identically: each derives deterministic Event
 * IDs from stable business inputs, so re-running a pipeline over
 * already-processed data must recover cleanly rather than fail. Returns
 * only the ID — on the "already published" path there is no full envelope
 * to honestly return without re-fetching it, and no caller needs more than
 * the ID back.
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
