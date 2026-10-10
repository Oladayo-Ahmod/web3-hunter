import {
  BountyProgramRecorded,
  BountyProgramUpdated,
  type BountyAuditFields,
} from "@web3-hunter/collectors";
import { getDb, schema } from "@web3-hunter/db";
import {
  getBugBountyByTargetAndPlatform,
  getSecurityTargetIntelligence,
  isBountyProgramExpired,
  listSecuritySignalsForTarget,
} from "@web3-hunter/security";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type {
  SecurityTargetActionabilityDTO,
  SecurityTargetAuditEvidenceDTO,
  SecurityTargetPriorityDTO,
} from "./dto";
import { countDistinctTriggeringEvents, securityTargetPriorityTier } from "./security-priority";

type SecurityTargetRow = typeof schema.securityTarget.$inferSelect;

/**
 * The subset of a bounty-program source Event's metadata this read model
 * needs — deliberately narrower than `BountyProgramFields` (which
 * `packages/application` has no reason to import in full): just enough to
 * read preserved audit evidence and current bounty scope. Validated
 * defensively (`.safeParse`, never thrown) because this reads back a
 * `jsonb` column — a system boundary, even though the pipeline that wrote
 * it already validated it once.
 */
const bountyEventMetadataSubsetSchema = z
  .object({
    audits: z
      .array(
        z.object({
          id: z.string(),
          url: z.string().nullable(),
          auditor: z.string().nullable(),
          date: z.string().nullable(),
        }),
      )
      .optional(),
    smartContractAssetIds: z.array(z.string()).optional(),
    // See `isBountyProgramExpired`'s doc comment (`@web3-hunter/security`):
    // the only field that reliably distinguishes a concluded, time-boxed
    // competition from an ongoing one — `isPaused` stays `false` for a
    // concluded competition, so `bug_bounty.status` alone cannot tell.
    endDate: z.string().nullable().optional(),
  })
  .passthrough();

const IMMUNEFI_PLATFORM = "immunefi";

const AUDIT_EVIDENCE_LIMITATION =
  "An audit record's existence does not confirm it covers the currently deployed code, that " +
  "it is recent, or that the target is otherwise secure.";

/** Every bounty-program source Event for one Security Target, most recent first — the only ordering `listSecuritySignalsForTarget`-style store functions don't already provide. */
interface LatestBountyProgramFields {
  audits: BountyAuditFields[];
  smartContractAssetIds: string[];
  endDate: string | null;
}

async function getLatestBountyProgramFields(
  securityTargetId: string,
): Promise<LatestBountyProgramFields | null> {
  const db = getDb();
  const [latestEvent] = await db
    .select()
    .from(schema.event)
    .where(
      and(
        eq(schema.event.relatedEntityType, "security_target"),
        eq(schema.event.relatedEntityId, securityTargetId),
        inArray(schema.event.type, [BountyProgramRecorded.name, BountyProgramUpdated.name]),
      ),
    )
    .orderBy(desc(schema.event.occurredAt), desc(schema.event.id))
    .limit(1);

  if (!latestEvent) {
    return null;
  }

  const parsed = bountyEventMetadataSubsetSchema.safeParse(latestEvent.metadata);
  if (!parsed.success) {
    return null;
  }

  return {
    audits: parsed.data.audits ?? [],
    smartContractAssetIds: parsed.data.smartContractAssetIds ?? [],
    endDate: parsed.data.endDate ?? null,
  };
}

function deriveAuditEvidence(
  bountyFields: { audits: BountyAuditFields[] } | null,
): SecurityTargetAuditEvidenceDTO {
  if (!bountyFields) {
    return { status: "unavailable", entries: [], limitation: AUDIT_EVIDENCE_LIMITATION };
  }
  if (bountyFields.audits.length === 0) {
    return { status: "none", entries: [], limitation: AUDIT_EVIDENCE_LIMITATION };
  }
  return {
    status: "present",
    entries: bountyFields.audits.map((audit) => ({
      id: audit.id,
      auditor: audit.auditor,
      url: audit.url,
      date: audit.date,
    })),
    limitation: AUDIT_EVIDENCE_LIMITATION,
  };
}

async function deriveActionability(
  securityTargetId: string,
  bountyFields: LatestBountyProgramFields | null,
): Promise<SecurityTargetActionabilityDTO> {
  const bounty = await getBugBountyByTargetAndPlatform(securityTargetId, IMMUNEFI_PLATFORM);

  if (!bounty || bounty.status !== "active") {
    return {
      isActionable: false,
      reason: bounty
        ? `The Immunefi bounty program is currently ${bounty.status}, not active.`
        : "No active bug bounty program is on record for this target.",
    };
  }

  // `bug_bounty.status` reflects Immunefi's own `isPaused` flag alone,
  // which stays `false` for a concluded, time-boxed competition (see
  // `isBountyProgramExpired`'s doc comment) — so "active" here does not
  // yet mean "not concluded." Checked independently, against the same
  // `endDate` field and comparison rule every detector already applies.
  if (isBountyProgramExpired(bountyFields?.endDate ?? null, new Date())) {
    return {
      isActionable: false,
      reason: "The Immunefi bounty program has already concluded (its endDate has passed).",
    };
  }

  const assetCount = bountyFields?.smartContractAssetIds.length ?? 0;
  if (assetCount === 0) {
    return {
      isActionable: false,
      reason: "An active bounty program exists, but no smart-contract asset is currently in scope.",
    };
  }

  return {
    isActionable: true,
    reason: `An active bounty program lists ${assetCount} smart-contract asset(s) in scope to review.`,
  };
}

async function buildSecurityTargetPriority(
  target: SecurityTargetRow,
): Promise<SecurityTargetPriorityDTO> {
  const db = getDb();

  const [signals, intelligence, bountyFields, opportunityRows] = await Promise.all([
    listSecuritySignalsForTarget(target.id),
    getSecurityTargetIntelligence(target.id),
    getLatestBountyProgramFields(target.id),
    db
      .select({ id: schema.securityOpportunity.id })
      .from(schema.securityOpportunity)
      .where(eq(schema.securityOpportunity.securityTargetId, target.id))
      .limit(1),
  ]);

  const { tier, reason, qualifyingSignalTypes } = securityTargetPriorityTier(
    signals.map((signal) => signal.signalType),
  );

  const actionability = await deriveActionability(target.id, bountyFields);

  return {
    id: target.id,
    slug: target.slug,
    name: target.name,
    tier,
    tierReason: reason,
    qualifyingSignalTypes,
    distinctEvidenceEventCount: countDistinctTriggeringEvents(signals),
    lastSignalAt: intelligence?.lastSignalAt?.toISOString() ?? null,
    hasOpportunity: opportunityRows.length > 0,
    identity: { repositoryUrl: target.repositoryUrl },
    audit: deriveAuditEvidence(bountyFields),
    actionability,
  };
}

/**
 * The Security Research Prioritization read model (the approved design):
 * one row per Security Target, ordered deterministically by `slug` so
 * repeat reads are stable. Deliberately returns *every* Security Target,
 * including those with no qualifying Signal and no Opportunity (Tier C)
 * — a discovery-only target is a real result this view must surface, not
 * something to filter out before a caller ever sees it.
 *
 * No numeric score, no persisted state: every field is computed at read
 * time from the existing Signal/Intelligence/Opportunity/bounty/Event
 * data, per the approved design's "do not introduce numeric weights
 * without a validation basis."
 */
export async function listSecurityTargetPriority(): Promise<SecurityTargetPriorityDTO[]> {
  const db = getDb();
  const targets = await db
    .select()
    .from(schema.securityTarget)
    .orderBy(asc(schema.securityTarget.slug));

  return Promise.all(targets.map((target) => buildSecurityTargetPriority(target)));
}
