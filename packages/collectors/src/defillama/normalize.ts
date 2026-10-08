import type { Normalizer } from "@web3-hunter/ingestion";
import {
  createProtocolNormalizer,
  type CanonicalProtocol,
  type ProtocolFields,
} from "../protocol-events";
import { defiLlamaProtocolSchema } from "./types";

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
