import { deriveDeterministicId } from "@web3-hunter/shared";

/**
 * Derives an AI artifact's row ID deterministically from its artifact
 * type, source entity ID, and version — so a crash-retried or
 * concurrently-triggered generation for the same (source, version) pair
 * recovers cleanly (an `onConflictDoNothing` insert) rather than
 * duplicating, the same idempotency discipline every other package in
 * this system uses for its own deterministic IDs.
 */
export function deriveArtifactId(
  artifactType: string,
  sourceEntityId: string,
  version: number,
): string {
  return deriveDeterministicId(`web3-hunter:ai:${artifactType}:${sourceEntityId}:v${version}`);
}
