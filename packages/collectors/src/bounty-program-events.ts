import { registerEventType, type NormalizedEvent, type Normalizer } from "@web3-hunter/ingestion";
import { z } from "zod";

/**
 * The canonical bug-bounty-program-facts vocabulary a bounty-catalog
 * Collector normalizes into — `BountyProgramRecorded`/
 * `BountyProgramUpdated`, with one shared `BountyProgramFields` shape.
 * Mirrors `./protocol-events.ts`'s role for protocol-data Collectors: the
 * event types are registered once, here, shared — never per-Collector —
 * so a future second bounty-catalog source would normalize into this
 * same canonical shape rather than inventing its own.
 */

const bountyAssetFieldsSchema = z.object({
  id: z.string(),
  // Open text, not a closed enum: Immunefi's own asset taxonomy
  // ("smart_contract", "websites_and_applications", "blockchain_dlt" as
  // verified live) is its vocabulary to grow, not ours to guess ahead of.
  type: z.string(),
  description: z.string().nullable(),
  url: z.string().nullable(),
});
export type BountyAssetFields = z.infer<typeof bountyAssetFieldsSchema>;

/**
 * The source's own audit-history entry — preserved as-is, never
 * interpreted. Recording that an audit entry exists is not the same as
 * confirming it covers the currently deployed code, or that the
 * protocol is safe; nothing in this canonical shape, or anything that
 * reads it, should imply either. See
 * `packages/application/src/dto.ts`'s `SecurityTargetAuditEvidenceDTO`
 * doc comment for where this distinction matters most.
 */
const bountyAuditFieldsSchema = z.object({
  id: z.string(),
  url: z.string().nullable(),
  auditor: z.string().nullable(),
  date: z.string().nullable(),
});
export type BountyAuditFields = z.infer<typeof bountyAuditFieldsSchema>;

const bountyProgramFieldsSchema = z.object({
  slug: z.string(),
  project: z.string(),
  ecosystem: z.array(z.string()),
  // ISO 8601 strings, kept as the source's own native format rather than
  // converted to unix seconds (unlike `ProtocolFields.listedAt`) —
  // Immunefi already supplies a parseable timestamp, so there is nothing
  // to gain from a lossy round-trip through integer seconds.
  launchDate: z.string(),
  // ISO 8601, or `null` for an ongoing/perpetual program — verified live
  // against the real feed: every non-null value seen is in the past, and
  // it is the only field that reliably distinguishes a concluded,
  // time-boxed competition from an ongoing bounty (`isPaused` is `false`
  // for every concluded competition observed; `programType` and slug/
  // project text are not reliable discriminators either — see
  // `immunefi-detectors.ts`'s `isExpired` doc comment). `.optional()` as
  // well as `.nullable()` for the same reason
  // `packages/scoring/src/event-types.ts`'s `OpportunityScored.signalCount`
  // is optional: historical Events published before this field existed
  // don't have it, and `metadataSchema.parse()` runs against historical
  // metadata too (replay) — a required field here would fail parsing
  // every such Event.
  endDate: z.string().nullable().optional(),
  isPaused: z.boolean(),
  pausedAt: z.string().nullable(),
  maxBounty: z.number(),
  rewardsPool: z.number(),
  githubUrl: z.string().nullable(),
  websiteUrl: z.string().nullable(),
  kyc: z.boolean(),
  inviteOnly: z.boolean(),
  // The full current asset catalog (every type) — preserved for Signal
  // evidence (which specific asset was added/removed, with its
  // description/url), not itself the field a detector diffs against.
  assets: z.array(bountyAssetFieldsSchema),
  // Immunefi's own audit history — see `bountyAuditFieldsSchema`'s doc
  // comment. Diffable like every other field here: a genuinely new
  // audit entry produces a `BountyProgramUpdated`, available as evidence
  // for a future detector — no detector reacts to it in this phase.
  audits: z.array(bountyAuditFieldsSchema),
  // A separate, sorted, `smart_contract`-only id list — the field a
  // scope-change detector actually diffs. Kept distinct from `assets` so
  // a revision bump or description edit on an *existing* asset (which
  // changes `assets` but not which ids exist) never looks like a scope
  // change — see `immunefi-detectors.ts`'s `bountyScopeExpandedDetector`.
  smartContractAssetIds: z.array(z.string()),
});

export type BountyProgramFields = z.infer<typeof bountyProgramFieldsSchema>;

const bountyProgramRecordedMetadataSchema = bountyProgramFieldsSchema;
const bountyProgramUpdatedMetadataSchema = bountyProgramFieldsSchema.extend({
  changedFrom: bountyProgramFieldsSchema.partial(),
});

export const BountyProgramRecorded = registerEventType({
  name: "BountyProgramRecorded",
  category: "source",
  version: 1,
  metadataSchema: bountyProgramRecordedMetadataSchema,
});

export const BountyProgramUpdated = registerEventType({
  name: "BountyProgramUpdated",
  category: "source",
  version: 1,
  metadataSchema: bountyProgramUpdatedMetadataSchema,
});

/** A source payload mapped to the canonical shape — the one thing a bounty-catalog Collector's normalizer supplies. */
export interface CanonicalBountyProgram {
  fields: BountyProgramFields;
  /**
   * When this program's state actually last changed, per the source's
   * own `updatedDate` — never wall-clock "now" (mirrors
   * `CanonicalRepository.occurredAt`). Deliberately not part of
   * `BountyProgramFields` itself: if it were a diffable canonical field,
   * a source bumping it for reasons unrelated to anything we track would
   * make every poll look like a "change," defeating the field-level
   * diffing below.
   */
  occurredAt: Date;
}

function diffBountyProgramFields(
  current: BountyProgramFields,
  previous: BountyProgramFields,
): Partial<BountyProgramFields> {
  const changedFrom: Partial<BountyProgramFields> = {};

  for (const key of Object.keys(current) as (keyof BountyProgramFields)[]) {
    if (JSON.stringify(current[key]) !== JSON.stringify(previous[key])) {
      (changedFrom as Record<string, unknown>)[key] = previous[key];
    }
  }

  return changedFrom;
}

/**
 * Builds a bounty-catalog Collector's normalizer for one Security
 * Target. Pure and synchronous, per `Normalizer`'s contract.
 *
 * `occurredAt` comes from the current payload's own `CanonicalBountyProgram.occurredAt`
 * (Immunefi's `updatedDate`, verified always present) — never wall-clock
 * "now." Deliberately does **not** assume this timestamp is
 * monotonically increasing across polls: the ingestion pipeline's
 * "previous payload" lookup (`packages/ingestion`'s `findPreviousPayload`)
 * already orders by our own Raw Record insertion order, never by the
 * source's own timestamp, so a corrected/out-of-order `updatedDate`
 * changes only which `occurredAt` an Event carries, never which payload
 * is treated as "previous" or whether a diff is detected.
 */
export function createBountyProgramNormalizer(
  securityTargetId: string,
  toCanonicalBountyProgram: (payload: unknown) => CanonicalBountyProgram,
): Normalizer {
  return (input) => {
    const current = toCanonicalBountyProgram(input.payload);

    if (!input.previousPayload) {
      const event: NormalizedEvent = {
        type: BountyProgramRecorded.name,
        metadata: current.fields,
        occurredAt: current.occurredAt,
        confidence: 1,
        relatedEntityType: "security_target",
        relatedEntityId: securityTargetId,
      };
      return event;
    }

    const previous = toCanonicalBountyProgram(input.previousPayload);
    const changedFrom = diffBountyProgramFields(current.fields, previous.fields);

    if (Object.keys(changedFrom).length === 0) {
      return null;
    }

    const event: NormalizedEvent = {
      type: BountyProgramUpdated.name,
      metadata: { ...current.fields, changedFrom },
      occurredAt: current.occurredAt,
      confidence: 1,
      relatedEntityType: "security_target",
      relatedEntityId: securityTargetId,
    };
    return event;
  };
}
