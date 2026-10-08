import { z } from "zod";
import { registerSecuritySignalDetector, registerSecuritySignalType } from "../registry";
import type {
  RecentSecurityTargetEvent,
  SecuritySignalCandidate,
  SecuritySignalDetector,
} from "../types";

// Canonical Event Type names the DefiLlama Collector's normalizer
// (`packages/collectors/src/protocol-events.ts`) registers and publishes.
// Referenced as plain strings, not imported from packages/collectors:
// packages/security never depends on packages/collectors (same rule
// packages/scoring's hiring-detectors.ts documents) — the canonical
// vocabulary lives in @web3-hunter/events' registry, not in any one
// producer's code.
const PROTOCOL_SNAPSHOT_RECORDED = "ProtocolSnapshotRecorded";
const PROTOCOL_SNAPSHOT_UPDATED = "ProtocolSnapshotUpdated";

/**
 * The subset of a Protocol Snapshot Event's metadata these detectors
 * need. Validated defensively (`safeParse`), matching the same
 * discipline `hiring-detectors.ts` applies: a detector declines to fire
 * rather than throwing if the metadata doesn't carry the expected shape.
 */
const protocolSnapshotMetadataSchema = z.object({
  slug: z.string(),
  name: z.string(),
  category: z.string().nullable(),
  tvl: z.number().nullable(),
  change1d: z.number().nullable(),
  change7d: z.number().nullable(),
  listedAt: z.number().nullable(),
  audits: z.string().nullable(),
  auditLinks: z.array(z.string()),
  chains: z.array(z.string()),
  changedFrom: z.record(z.string(), z.unknown()).optional(),
});
type ProtocolSnapshotMetadata = z.infer<typeof protocolSnapshotMetadataSchema>;

function parseSnapshot(event: RecentSecurityTargetEvent): ProtocolSnapshotMetadata | null {
  const parsed = protocolSnapshotMetadataSchema.safeParse(event.metadata);
  return parsed.success ? parsed.data : null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

// --- 1. New protocol observed ----------------------------------------------

export const NEW_PROTOCOL = registerSecuritySignalType("new-protocol");

const NEW_PROTOCOL_LISTED_AT_RECENCY_DAYS = 30;
const NEW_PROTOCOL_WEIGHT_WITH_RECENT_LISTED_AT = 0.5;
const NEW_PROTOCOL_WEIGHT_WITHOUT_CORROBORATION = 0.3;

/**
 * Fires once, the first time our own poll history observes a protocol
 * (`ProtocolSnapshotRecorded` — see `runIngestionPipeline`'s "no previous
 * payload" case). Deliberately does not conflate two distinct facts, per
 * the Phase 2B Step 1 brief: "a protocol appearing for the first time in
 * our own poll history" (what triggers this detector) and "a protocol
 * having a recent DefiLlama `listedAt` timestamp" (a separate, weaker
 * corroborating fact DefiLlama supplies, which may itself lag — or
 * predate — this protocol's true real-world launch). Both are recorded
 * explicitly in the reasoning text and both drive the weight, rather than
 * one being presented as if it were the other.
 */
export const newProtocolDetector: SecuritySignalDetector = (triggeringEvent) => {
  if (triggeringEvent.type !== PROTOCOL_SNAPSHOT_RECORDED) {
    return [];
  }

  const snapshot = parseSnapshot(triggeringEvent);
  if (!snapshot) {
    return [];
  }

  const listedAtDate = snapshot.listedAt !== null ? new Date(snapshot.listedAt * 1000) : null;
  const listedAtRecent =
    listedAtDate !== null &&
    triggeringEvent.occurredAt.getTime() - listedAtDate.getTime() <=
      NEW_PROTOCOL_LISTED_AT_RECENCY_DAYS * DAY_MS;

  const listedAtClause =
    listedAtDate === null
      ? "DefiLlama does not report a listedAt timestamp for it."
      : `DefiLlama's own listedAt (${listedAtDate.toISOString()}) is ` +
        `${listedAtRecent ? "" : "not "}within the last ${NEW_PROTOCOL_LISTED_AT_RECENCY_DAYS} days.`;

  const candidate: SecuritySignalCandidate = {
    signalType: NEW_PROTOCOL,
    weight: listedAtRecent
      ? NEW_PROTOCOL_WEIGHT_WITH_RECENT_LISTED_AT
      : NEW_PROTOCOL_WEIGHT_WITHOUT_CORROBORATION,
    reasoning:
      `"${snapshot.name}" was observed for the first time by our DefiLlama poll. ${listedAtClause} ` +
      "These are related but distinct facts: our first observation reflects when we started " +
      "tracking it, not necessarily when it actually launched.",
    sourceEventIds: [triggeringEvent.id],
  };
  return [candidate];
};

// --- 2. TVL growth -----------------------------------------------------------

export const TVL_GROWTH = registerSecuritySignalType("tvl-growth");

const TVL_GROWTH_MIN_ABSOLUTE_TVL = 5_000_000;
const TVL_GROWTH_MIN_PERCENT_INCREASE = 0.2;
const TVL_GROWTH_MAX_WEIGHT = 0.8;
const TVL_GROWTH_BASE_WEIGHT = 0.3;

/**
 * Fires when a protocol's TVL has grown meaningfully since our previous
 * poll. Gated on both an absolute TVL floor and a minimum percent
 * increase, per the Phase 2B Step 1 brief: "Do not score based purely on
 * percentage growth... avoid generating noisy signals for tiny protocols
 * with extreme percentage changes." The absolute current TVL, previous
 * TVL, and dollar delta are preserved in the reasoning text so a future
 * scoring pass can apply its own floor independently of this detector's.
 */
export const tvlGrowthDetector: SecuritySignalDetector = (triggeringEvent) => {
  if (triggeringEvent.type !== PROTOCOL_SNAPSHOT_UPDATED) {
    return [];
  }

  const snapshot = parseSnapshot(triggeringEvent);
  if (!snapshot || snapshot.tvl === null || !snapshot.changedFrom) {
    return [];
  }

  const previousTvlRaw = snapshot.changedFrom.tvl;
  if (typeof previousTvlRaw !== "number" || previousTvlRaw <= 0) {
    return [];
  }

  const currentTvl = snapshot.tvl;
  const absoluteDelta = currentTvl - previousTvlRaw;
  const percentIncrease = absoluteDelta / previousTvlRaw;

  if (
    currentTvl < TVL_GROWTH_MIN_ABSOLUTE_TVL ||
    percentIncrease < TVL_GROWTH_MIN_PERCENT_INCREASE
  ) {
    return [];
  }

  const weight = Math.min(TVL_GROWTH_MAX_WEIGHT, TVL_GROWTH_BASE_WEIGHT + percentIncrease);

  const candidate: SecuritySignalCandidate = {
    signalType: TVL_GROWTH,
    weight,
    reasoning:
      `"${snapshot.name}" TVL grew from $${previousTvlRaw.toLocaleString()} to ` +
      `$${currentTvl.toLocaleString()} (+${(percentIncrease * 100).toFixed(1)}%, ` +
      `+$${absoluteDelta.toLocaleString()}) since the previous poll. ` +
      `DefiLlama's own 7-day change figure: ${snapshot.change7d ?? "unavailable"}.`,
    sourceEventIds: [triggeringEvent.id],
  };
  return [candidate];
};

// --- 3. Audit coverage gap (weak negative signal) ---------------------------

export const AUDIT_COVERAGE_GAP = registerSecuritySignalType("audit-coverage-gap");

const AUDIT_COVERAGE_GAP_MIN_TVL = 2_000_000;
const AUDIT_COVERAGE_GAP_WEIGHT = 0.3;

/**
 * Fires when DefiLlama's own metadata does not record any audits for a
 * protocol carrying meaningful TVL. Per the Phase 2B Step 1 brief's
 * CRITICAL constraint: this must never be represented as proof the
 * protocol is unaudited — DefiLlama's `audits` count reflects what a
 * project has chosen to submit to DefiLlama's own listing, not an
 * independent audit registry. The reasoning text below uses the exact
 * phrasing the brief specifies, and preserves `auditLinks` (even when
 * empty) so a future enrichment step can investigate further.
 */
export const auditCoverageGapDetector: SecuritySignalDetector = (triggeringEvent) => {
  if (
    triggeringEvent.type !== PROTOCOL_SNAPSHOT_RECORDED &&
    triggeringEvent.type !== PROTOCOL_SNAPSHOT_UPDATED
  ) {
    return [];
  }

  const snapshot = parseSnapshot(triggeringEvent);
  if (!snapshot || snapshot.tvl === null) {
    return [];
  }

  if (snapshot.audits !== "0" || snapshot.tvl < AUDIT_COVERAGE_GAP_MIN_TVL) {
    return [];
  }

  const auditLinksClause =
    snapshot.auditLinks.length > 0
      ? `Recorded audit links for future investigation: ${snapshot.auditLinks.join(", ")}.`
      : "No audit links are recorded either.";

  const candidate: SecuritySignalCandidate = {
    signalType: AUDIT_COVERAGE_GAP,
    weight: AUDIT_COVERAGE_GAP_WEIGHT,
    reasoning:
      `Limited audit coverage indicated by available DefiLlama metadata. "${snapshot.name}" carries ` +
      `$${snapshot.tvl.toLocaleString()} TVL with an audits count of "0" in DefiLlama's listing. ` +
      `This does not confirm the protocol is unaudited — only that DefiLlama's own listing does not ` +
      `record an audit count greater than zero. ${auditLinksClause}`,
    sourceEventIds: [triggeringEvent.id],
  };
  return [candidate];
};

// Registered at module load, the same convention
// packages/scoring/src/detectors/hiring-detectors.ts uses: importing this
// module (which src/index.ts always does) is what makes these detectors
// active.
registerSecuritySignalDetector(newProtocolDetector);
registerSecuritySignalDetector(tvlGrowthDetector);
registerSecuritySignalDetector(auditCoverageGapDetector);
