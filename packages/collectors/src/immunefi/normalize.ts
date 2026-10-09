import type { Normalizer } from "@web3-hunter/ingestion";
import {
  createBountyProgramNormalizer,
  type BountyAssetFields,
  type BountyAuditFields,
  type BountyProgramFields,
  type CanonicalBountyProgram,
} from "../bounty-program-events";
import { immunefiBountySchema, type ImmunefiAsset, type ImmunefiAudit } from "./types";

const SMART_CONTRACT_ASSET_TYPE = "smart_contract";

function toAssetFields(asset: ImmunefiAsset): BountyAssetFields {
  return {
    id: asset.id,
    type: asset.type,
    description: asset.description ?? null,
    url: asset.url ?? null,
  };
}

function toAuditFields(audit: ImmunefiAudit): BountyAuditFields {
  return {
    id: audit.id,
    url: audit.url ?? null,
    auditor: audit.auditor ?? null,
    date: audit.date ?? null,
  };
}

function smartContractAssetIds(assets: readonly BountyAssetFields[]): string[] {
  return assets
    .filter((asset) => asset.type === SMART_CONTRACT_ASSET_TYPE)
    .map((asset) => asset.id)
    .sort();
}

function toCanonicalBountyProgram(payload: unknown): CanonicalBountyProgram {
  const bounty = immunefiBountySchema.parse(payload);
  const assets = bounty.assets.map(toAssetFields);

  const fields: BountyProgramFields = {
    slug: bounty.slug,
    project: bounty.project,
    ecosystem: bounty.ecosystem,
    launchDate: bounty.launchDate,
    endDate: bounty.endDate ?? null,
    isPaused: bounty.isPaused,
    pausedAt: bounty.pausedAt ?? null,
    maxBounty: bounty.maxBounty,
    rewardsPool: bounty.rewardsPool,
    githubUrl: bounty.githubUrl ?? null,
    websiteUrl: bounty.websiteUrl ?? null,
    kyc: bounty.kyc,
    inviteOnly: bounty.inviteOnly,
    assets,
    audits: bounty.audits.map(toAuditFields),
    smartContractAssetIds: smartContractAssetIds(assets),
  };

  return { fields, occurredAt: new Date(bounty.updatedDate) };
}

/**
 * Builds this Collector's normalizer for one Security Target. All the
 * canonical-event logic (Recorded vs. Updated vs. skip) lives in
 * `../bounty-program-events`, shared with any future bounty-catalog
 * Collector — this module supplies only Immunefi's own payload shape.
 */
export function createImmunefiBountyProgramNormalizer(securityTargetId: string): Normalizer {
  return createBountyProgramNormalizer(securityTargetId, toCanonicalBountyProgram);
}
