import type { Normalizer } from "@web3-hunter/ingestion";
import {
  createProtocolNormalizer,
  type CanonicalProtocol,
  type ProtocolFields,
} from "../protocol-events";
import { defiLlamaProtocolSchema } from "./types";

/**
 * Derives a GitHub organization URL from a stored DefiLlama Raw Record
 * payload, for cross-source identity reconciliation (see
 * `packages/security/src/security-target-store.ts`'s
 * `resolveSecurityTargetWithCollisionCheck`) — not part of
 * `ProtocolFields`/the canonical Signal-detection shape, since DefiLlama's
 * `github` field is deliberately not tracked as a diffable fact (no
 * Signal should ever fire from a GitHub org changing).
 *
 * Defensive by design: `payload` here is untrusted, potentially-stale
 * stored data read back for a one-off repair attempt, not a fresh,
 * already-validated fetch — `safeParse` so a malformed or
 * schema-incompatible stored payload is rejected (returns `null`)
 * rather than throwing and aborting the caller's run.
 */
export function deriveRepositoryUrlFromDefiLlamaPayload(payload: unknown): string | null {
  const parsed = defiLlamaProtocolSchema.safeParse(payload);
  if (!parsed.success) {
    return null;
  }

  const owner = parsed.data.github?.[0];
  return owner ? `https://github.com/${owner}` : null;
}

function toCanonicalProtocol(payload: unknown): CanonicalProtocol {
  const protocol = defiLlamaProtocolSchema.parse(payload);

  const fields: ProtocolFields = {
    slug: protocol.slug,
    name: protocol.name,
    category: protocol.category ?? null,
    tvl: protocol.tvl ?? null,
    change1d: protocol.change_1d ?? null,
    change7d: protocol.change_7d ?? null,
    listedAt: protocol.listedAt ?? null,
    audits: protocol.audits ?? null,
    auditLinks: protocol.audit_links ?? [],
    chains: protocol.chains,
  };

  return { fields };
}

/**
 * Builds this Collector's normalizer for one Security Target. All the
 * canonical-event logic (Recorded vs. Updated vs. skip) lives in
 * `../protocol-events`, shared with any future protocol-data Collector —
 * this module supplies only DefiLlama's own payload shape.
 */
export function createDefiLlamaProtocolNormalizer(securityTargetId: string): Normalizer {
  return createProtocolNormalizer(securityTargetId, toCanonicalProtocol);
}
