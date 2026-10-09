import { z } from "zod";
import { registerSecuritySignalDetector, registerSecuritySignalType } from "../registry";
import type {
  RecentSecurityTargetEvent,
  SecuritySignalCandidate,
  SecuritySignalDetector,
} from "../types";

// Canonical Event Type names the Immunefi Collector's normalizer
// (`packages/collectors/src/bounty-program-events.ts`) registers and
// publishes. Referenced as plain strings, not imported from
// packages/collectors: packages/security never depends on
// packages/collectors (same rule `defillama-detectors.ts` documents).
const BOUNTY_PROGRAM_RECORDED = "BountyProgramRecorded";
const BOUNTY_PROGRAM_UPDATED = "BountyProgramUpdated";

const bountyAssetMetadataSchema = z.object({
  id: z.string(),
  type: z.string(),
  description: z.string().nullable(),
  url: z.string().nullable(),
});

/**
 * The subset of a Bounty Program Event's metadata these detectors need.
 * Validated defensively (`safeParse`), matching the same discipline
 * `defillama-detectors.ts` applies.
 */
const bountyProgramMetadataSchema = z.object({
  slug: z.string(),
  project: z.string(),
  ecosystem: z.array(z.string()),
  launchDate: z.string(),
  isPaused: z.boolean(),
  pausedAt: z.string().nullable(),
  maxBounty: z.number(),
  rewardsPool: z.number(),
  githubUrl: z.string().nullable(),
  websiteUrl: z.string().nullable(),
  kyc: z.boolean(),
  inviteOnly: z.boolean(),
  assets: z.array(bountyAssetMetadataSchema),
  smartContractAssetIds: z.array(z.string()),
  changedFrom: z
    .object({
      isPaused: z.boolean().optional(),
      smartContractAssetIds: z.array(z.string()).optional(),
      assets: z.array(bountyAssetMetadataSchema).optional(),
    })
    .partial()
    .optional(),
});
type BountyProgramMetadata = z.infer<typeof bountyProgramMetadataSchema>;

function parseBountySnapshot(event: RecentSecurityTargetEvent): BountyProgramMetadata | null {
  const parsed = bountyProgramMetadataSchema.safeParse(event.metadata);
  return parsed.success ? parsed.data : null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

// --- 1. Bounty program observed --------------------------------------------

export const BOUNTY_PROGRAM_OBSERVED = registerSecuritySignalType("bounty-program-observed", {
  qualifiesForOpportunity: false,
});

const BOUNTY_OBSERVED_LAUNCH_RECENCY_DAYS = 30;
const BOUNTY_OBSERVED_WEIGHT_WITH_RECENT_LAUNCH = 0.5;
const BOUNTY_OBSERVED_WEIGHT_WITHOUT_CORROBORATION = 0.3;

/**
 * Fires once, the first time our own poll history observes a bounty
 * program (`BountyProgramRecorded`). Mirrors `newProtocolDetector`
 * exactly: never claims the program was "newly opened" merely because
 * we discovered it — `launchDate` (the source's own, separate fact) and
 * "first observed by us" are recorded as distinct, both cited, neither
 * presented as the other.
 */
export const bountyProgramObservedDetector: SecuritySignalDetector = (triggeringEvent) => {
  if (triggeringEvent.type !== BOUNTY_PROGRAM_RECORDED) {
    return [];
  }

  const snapshot = parseBountySnapshot(triggeringEvent);
  if (!snapshot) {
    return [];
  }

  const launchDate = new Date(snapshot.launchDate);
  const launchRecent =
    !Number.isNaN(launchDate.getTime()) &&
    triggeringEvent.occurredAt.getTime() - launchDate.getTime() <=
      BOUNTY_OBSERVED_LAUNCH_RECENCY_DAYS * DAY_MS;

  const candidate: SecuritySignalCandidate = {
    signalType: BOUNTY_PROGRAM_OBSERVED,
    weight: launchRecent
      ? BOUNTY_OBSERVED_WEIGHT_WITH_RECENT_LAUNCH
      : BOUNTY_OBSERVED_WEIGHT_WITHOUT_CORROBORATION,
    reasoning:
      `"${snapshot.project}"'s Immunefi bounty program was observed for the first time by our ` +
      `poll. Immunefi's own launchDate (${snapshot.launchDate}) is ` +
      `${launchRecent ? "" : "not "}within the last ${BOUNTY_OBSERVED_LAUNCH_RECENCY_DAYS} days. ` +
      "These are related but distinct facts: our first observation reflects when we started " +
      "tracking this program, not necessarily when it actually launched.",
    sourceEventIds: [triggeringEvent.id],
  };
  return [candidate];
};

// --- 2. Bounty program resumed ----------------------------------------------

export const BOUNTY_PROGRAM_RESUMED = registerSecuritySignalType("bounty-program-resumed", {
  qualifiesForOpportunity: true,
});

const BOUNTY_PROGRAM_RESUMED_WEIGHT = 0.6;

/**
 * Fires on a verified `isPaused: true -> false` transition. Gated on the
 * program currently carrying at least one `smart_contract` asset —
 * otherwise this is a resumed bounty with nothing a smart-contract
 * researcher could act on, and should not qualify an Opportunity. This
 * is a firing-time gate, not merely a qualification-time one: the
 * registry's `qualifiesForOpportunity` is a static per-type declaration,
 * so the "only when scope-relevant" nuance has to live in whether the
 * Signal is produced at all, not in a dynamic per-instance override.
 */
export const bountyProgramResumedDetector: SecuritySignalDetector = (triggeringEvent) => {
  if (triggeringEvent.type !== BOUNTY_PROGRAM_UPDATED) {
    return [];
  }

  const snapshot = parseBountySnapshot(triggeringEvent);
  if (!snapshot || snapshot.changedFrom?.isPaused !== true || snapshot.isPaused) {
    return [];
  }

  if (snapshot.smartContractAssetIds.length === 0) {
    return [];
  }

  const candidate: SecuritySignalCandidate = {
    signalType: BOUNTY_PROGRAM_RESUMED,
    weight: BOUNTY_PROGRAM_RESUMED_WEIGHT,
    reasoning:
      `"${snapshot.project}"'s Immunefi bounty program resumed from paused to active, with ` +
      `${snapshot.smartContractAssetIds.length} smart-contract asset(s) currently in scope.`,
    sourceEventIds: [triggeringEvent.id],
  };
  return [candidate];
};

// --- 3. Bounty program paused -----------------------------------------------

export const BOUNTY_PROGRAM_PAUSED = registerSecuritySignalType("bounty-program-paused", {
  qualifiesForOpportunity: false,
});

const BOUNTY_PROGRAM_PAUSED_WEIGHT = 0.2;

/**
 * Fires on a verified `isPaused: false -> true` transition. Purely
 * informational — a paused program is never an actionable research
 * target, regardless of its scope, so this never qualifies an
 * Opportunity.
 */
export const bountyProgramPausedDetector: SecuritySignalDetector = (triggeringEvent) => {
  if (triggeringEvent.type !== BOUNTY_PROGRAM_UPDATED) {
    return [];
  }

  const snapshot = parseBountySnapshot(triggeringEvent);
  if (!snapshot || snapshot.changedFrom?.isPaused !== false || !snapshot.isPaused) {
    return [];
  }

  const candidate: SecuritySignalCandidate = {
    signalType: BOUNTY_PROGRAM_PAUSED,
    weight: BOUNTY_PROGRAM_PAUSED_WEIGHT,
    reasoning:
      `"${snapshot.project}"'s Immunefi bounty program paused` +
      (snapshot.pausedAt ? ` at ${snapshot.pausedAt}` : "") +
      ".",
    sourceEventIds: [triggeringEvent.id],
  };
  return [candidate];
};

// --- 4. Bounty scope expanded ------------------------------------------------

export const BOUNTY_SCOPE_EXPANDED = registerSecuritySignalType("bounty-scope-expanded", {
  qualifiesForOpportunity: true,
});

const BOUNTY_SCOPE_EXPANDED_BASE_WEIGHT = 0.4;
const BOUNTY_SCOPE_EXPANDED_PER_ASSET_WEIGHT = 0.05;
const BOUNTY_SCOPE_EXPANDED_MAX_WEIGHT = 0.8;

/**
 * Fires when one or more `smart_contract`-typed asset ids appear that
 * weren't present in the previous poll — compared as sets, never by
 * array order or total count, per the brief. A newly added
 * `websites_and_applications`/`blockchain_dlt` asset never triggers
 * this: only `smartContractAssetIds` (already filtered to
 * `smart_contract` by the normalizer) is compared. An asset's `revision`
 * or `description` changing without its `id` set changing produces no
 * `changedFrom.smartContractAssetIds` at all (the field-level diff
 * upstream only records a field as changed when it's genuinely
 * different), so this correctly declines to fire for purely cosmetic
 * asset edits.
 *
 * Gated on the program currently being active: scope changes recorded
 * while paused must never retroactively become an actionable
 * Opportunity once the registry's static `qualifiesForOpportunity: true`
 * is in play — the only way to guarantee that is to never produce the
 * Signal in the first place while paused (see
 * `bountyProgramResumedDetector`'s doc comment for the same reasoning).
 */
export const bountyScopeExpandedDetector: SecuritySignalDetector = (triggeringEvent) => {
  if (triggeringEvent.type !== BOUNTY_PROGRAM_UPDATED) {
    return [];
  }

  const snapshot = parseBountySnapshot(triggeringEvent);
  if (!snapshot || snapshot.isPaused) {
    return [];
  }

  const previousIds = snapshot.changedFrom?.smartContractAssetIds;
  if (!previousIds) {
    return [];
  }

  const previousIdSet = new Set(previousIds);
  const currentIdSet = new Set(snapshot.smartContractAssetIds);
  const addedIds = [...currentIdSet].filter((id) => !previousIdSet.has(id));
  const removedIds = [...previousIdSet].filter((id) => !currentIdSet.has(id));

  if (addedIds.length === 0) {
    return [];
  }

  const currentAssetsById = new Map(snapshot.assets.map((asset) => [asset.id, asset]));
  const previousAssetsById = new Map(
    (snapshot.changedFrom?.assets ?? []).map((asset) => [asset.id, asset]),
  );

  const describeAsset = (id: string, source: Map<string, { description: string | null }>) =>
    source.get(id)?.description ?? id;

  const addedDescriptions = addedIds.map((id) => describeAsset(id, currentAssetsById));
  const removedDescriptions = removedIds.map((id) => describeAsset(id, previousAssetsById));

  const weight = Math.min(
    BOUNTY_SCOPE_EXPANDED_MAX_WEIGHT,
    BOUNTY_SCOPE_EXPANDED_BASE_WEIGHT + addedIds.length * BOUNTY_SCOPE_EXPANDED_PER_ASSET_WEIGHT,
  );

  const removedClause =
    removedDescriptions.length > 0
      ? ` Removed since the previous poll: ${removedDescriptions.join(", ")}.`
      : "";

  const candidate: SecuritySignalCandidate = {
    signalType: BOUNTY_SCOPE_EXPANDED,
    weight,
    reasoning:
      `"${snapshot.project}"'s Immunefi bounty program's smart-contract scope expanded. ` +
      `Added: ${addedDescriptions.join(", ")}.${removedClause}`,
    sourceEventIds: [triggeringEvent.id],
  };
  return [candidate];
};

// Registered at module load, the same convention
// `defillama-detectors.ts` uses: importing this module (which src/index.ts
// always does) is what makes these detectors active.
registerSecuritySignalDetector(bountyProgramObservedDetector);
registerSecuritySignalDetector(bountyProgramResumedDetector);
registerSecuritySignalDetector(bountyProgramPausedDetector);
registerSecuritySignalDetector(bountyScopeExpandedDetector);
