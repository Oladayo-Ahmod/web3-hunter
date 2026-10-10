import {
  BountyProgramRecorded,
  BountyProgramUpdated,
  type BountyAuditFields,
} from "@web3-hunter/collectors";
import { getDb, schema } from "@web3-hunter/db";
import {
  getBugBountyByTargetAndPlatform,
  getSecurityTargetBySlug,
  getSecurityTargetIntelligence,
  isBountyProgramExpired,
  listSecuritySignalsForTarget,
} from "@web3-hunter/security";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type {
  PaginatedResult,
  SecurityTargetActionabilityDTO,
  SecurityTargetAuditEvidenceDTO,
  SecurityTargetPriorityDTO,
  SecurityTargetScopeAssetDTO,
} from "./dto";
import {
  countDistinctTriggeringEvents,
  deriveResearchReadiness,
  SECURITY_TARGET_PRIORITY_TIERS,
  SECURITY_TARGET_RESEARCH_READINESS_STATUSES,
  securityTargetPriorityTier,
} from "./security-priority";

type SecurityTargetRow = typeof schema.securityTarget.$inferSelect;
type BugBountyStatus = (typeof schema.bugBountyStatus.enumValues)[number];

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
    // The full asset catalog (every type), in the source's own order —
    // kept separate from `smartContractAssetIds` (which is sorted by id,
    // not source order — see `bounty-program-events.ts`'s
    // `smartContractAssetIds` derivation). Optional: a payload captured
    // before per-asset detail was tracked has no `assets` key at all,
    // which must degrade to "no detail available," never a parse
    // failure or a fabricated record.
    assets: z
      .array(
        z.object({
          id: z.string(),
          type: z.string(),
          description: z.string().nullable(),
          url: z.string().nullable(),
        }),
      )
      .optional(),
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

/**
 * Every bounty-program source Event for one Security Target, most
 * recently *captured* first — the only ordering `listSecuritySignalsForTarget`-style
 * store functions don't already provide.
 *
 * Ordered by `event.recordedAt` (server-assigned at insertion via
 * `defaultNow()`/`publishEvent`'s own `recordedAt: new Date()` — see
 * `packages/events/src/publish.ts`), with `event.id` only as a
 * deterministic tiebreaker for same-instant inserts. Never by the
 * Event's own `occurredAt`: for a bounty-program Event, `occurredAt` is
 * the *source's* self-reported `updatedDate` (see
 * `bounty-program-events.ts`'s `CanonicalBountyProgram.occurredAt` doc
 * comment), which is explicitly not assumed to be monotonically
 * increasing across polls — the same reason `packages/ingestion`'s
 * `findPreviousPayload` avoids it too. And never by `event.id` alone:
 * Events published through the ingestion pipeline (as every
 * `BountyProgramRecorded`/`BountyProgramUpdated` Event is) get a
 * deterministic, content-hash-derived id (`deriveEventId(rawRecordId)`),
 * which carries no chronological relationship to capture order.
 * `recordedAt` is the one column on this table that genuinely reflects
 * "when we actually captured it" — the same convention already used by
 * `packages/ai/src/provenance.ts`, `packages/decision/src/provenance.ts`,
 * and `pipeline-run-query-service.ts`.
 */
interface LatestBountyProgramFields {
  audits: BountyAuditFields[];
  smartContractAssetIds: string[];
  /** The `smart_contract`-typed subset of the latest Event's `assets`, in source order — `[]` whenever `assets` metadata is absent, never derived from `smartContractAssetIds` alone. */
  smartContractAssets: SecurityTargetScopeAssetDTO[];
  endDate: string | null;
}

/**
 * Parses one bounty-program source Event's `metadata` into
 * `LatestBountyProgramFields` — extracted so both the existing
 * single-target lookup below and the paginated feed's batched
 * classification query (`getLatestBountyFieldsLightweightByTarget`)
 * apply the exact same parsing, filtering, and missing-data defaults.
 * Never throws: `.safeParse` degrades to `null` on a malformed payload,
 * same discipline as before this was extracted.
 */
function parseBountyEventMetadata(metadata: unknown): LatestBountyProgramFields | null {
  const parsed = bountyEventMetadataSubsetSchema.safeParse(metadata);
  if (!parsed.success) {
    return null;
  }

  const smartContractAssets = (parsed.data.assets ?? [])
    .filter((asset) => asset.type === "smart_contract")
    .map((asset) => ({ id: asset.id, description: asset.description, url: asset.url }));

  return {
    audits: parsed.data.audits ?? [],
    smartContractAssetIds: parsed.data.smartContractAssetIds ?? [],
    smartContractAssets,
    endDate: parsed.data.endDate ?? null,
  };
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
    .orderBy(desc(schema.event.recordedAt), desc(schema.event.id))
    .limit(1);

  if (!latestEvent) {
    return null;
  }

  return parseBountyEventMetadata(latestEvent.metadata);
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

/**
 * The single, shared "is this target currently actionable" predicate —
 * extracted so the full per-target `deriveActionability` below and the
 * paginated feed's lightweight batch classifier apply the exact same
 * three conditions, in the same precedence, rather than the latter
 * re-deriving a second, possibly-drifting copy of this rule. `status`,
 * `endDate`, and `assetCount` are exactly the three primitives
 * `deriveActionability`'s own branches already gate on.
 */
function computeIsActionable(
  status: BugBountyStatus | undefined,
  endDate: string | null,
  assetCount: number,
  now: Date,
): boolean {
  return status === "active" && !isBountyProgramExpired(endDate, now) && assetCount > 0;
}

async function deriveActionability(
  securityTargetId: string,
  bountyFields: LatestBountyProgramFields | null,
): Promise<SecurityTargetActionabilityDTO> {
  const bounty = await getBugBountyByTargetAndPlatform(securityTargetId, IMMUNEFI_PLATFORM);
  // Read from the Bug Bounty row alone, regardless of status below — a
  // link to the program's own page, not a claim about eligibility.
  const scopeUrl = bounty?.scopeUrl ?? null;
  const endDate = bountyFields?.endDate ?? null;
  const assetCount = bountyFields?.smartContractAssetIds.length ?? 0;
  const now = new Date();

  if (!computeIsActionable(bounty?.status, endDate, assetCount, now)) {
    // Not actionable — walk the same three conditions, in the same
    // precedence `computeIsActionable` checked, only to pick which
    // reason text applies.
    if (!bounty || bounty.status !== "active") {
      return {
        isActionable: false,
        reason: bounty
          ? `The Immunefi bounty program is currently ${bounty.status}, not active.`
          : "No active bug bounty program is on record for this target.",
        scopeUrl,
        assets: [],
        totalAssetCount: 0,
      };
    }

    // `bug_bounty.status` reflects Immunefi's own `isPaused` flag alone,
    // which stays `false` for a concluded, time-boxed competition (see
    // `isBountyProgramExpired`'s doc comment) — so "active" here does
    // not yet mean "not concluded." Checked independently, against the
    // same `endDate` field and comparison rule every detector already
    // applies.
    if (isBountyProgramExpired(endDate, now)) {
      return {
        isActionable: false,
        reason: "The Immunefi bounty program has already concluded (its endDate has passed).",
        scopeUrl,
        assets: [],
        totalAssetCount: 0,
      };
    }

    return {
      isActionable: false,
      reason: "An active bounty program exists, but no smart-contract asset is currently in scope.",
      scopeUrl,
      assets: [],
      totalAssetCount: 0,
    };
  }

  // `assetCount` (from `smartContractAssetIds`) and `assets.length` (from
  // the separately-recorded, optional per-asset `assets` metadata) can
  // legitimately differ — an older payload captured before per-asset
  // detail was tracked lists ids with no accompanying detail. The
  // `reason` text must never state a number that disagrees with
  // `totalAssetCount`/`assets` below: when detail is incomplete, it
  // names both counts explicitly rather than only the (larger,
  // detail-less) id count — this is evidence that ids exist, never a
  // claim that detailed records do.
  const assets = bountyFields?.smartContractAssets ?? [];
  const reason =
    assets.length === assetCount
      ? `An active bounty program lists ${assetCount} smart-contract asset(s) in scope to review.`
      : `An active bounty program lists ${assetCount} smart-contract asset(s) in scope; detailed records are available for ${assets.length} of them.`;
  return {
    isActionable: true,
    reason,
    scopeUrl,
    assets,
    totalAssetCount: assets.length,
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
    // Most recently *detected* Opportunity wins when more than one row
    // exists for this target (one per detection window) — deterministic,
    // never an arbitrary `.limit(1)` pick.
    db
      .select({
        id: schema.securityOpportunity.id,
        reasoning: schema.securityOpportunity.reasoning,
      })
      .from(schema.securityOpportunity)
      .where(eq(schema.securityOpportunity.securityTargetId, target.id))
      .orderBy(desc(schema.securityOpportunity.detectedAt), desc(schema.securityOpportunity.id))
      .limit(1),
  ]);

  const { tier, reason, qualifyingSignalTypes } = securityTargetPriorityTier(
    signals.map((signal) => signal.signalType),
  );

  // The ids of Signals whose *type* qualifies for an Opportunity — the
  // same registry-based rule `qualifyingSignalTypes` is already derived
  // from. Deliberately not sourced from `event_provenance`: that
  // relationship (for `SecurityOpportunityDetected`) cites every Signal
  // for the target, qualifying or not — see
  // `evaluateSecurityOpportunity`'s `signalIds` — so reading it here
  // would leak non-qualifying Signal ids into this field.
  const qualifyingSignalTypeSet = new Set(qualifyingSignalTypes);
  const qualifyingSignalIds = signals
    .filter((signal) => qualifyingSignalTypeSet.has(signal.signalType))
    .sort((a, b) => a.detectedAt.getTime() - b.detectedAt.getTime() || (a.id < b.id ? -1 : 1))
    .map((signal) => signal.id);

  const actionability = await deriveActionability(target.id, bountyFields);
  const researchReadiness = deriveResearchReadiness({
    isActionable: actionability.isActionable,
    actionableAssetCount: bountyFields?.smartContractAssetIds.length ?? 0,
    qualifyingSignalTypes,
    exampleAsset: actionability.assets[0] ?? null,
  });

  return {
    id: target.id,
    slug: target.slug,
    name: target.name,
    tier,
    tierReason: reason,
    qualifyingSignalTypes,
    qualifyingSignalIds,
    distinctEvidenceEventCount: countDistinctTriggeringEvents(signals),
    lastSignalAt: intelligence?.lastSignalAt?.toISOString() ?? null,
    hasOpportunity: opportunityRows.length > 0,
    opportunityReasoning: opportunityRows[0]?.reasoning ?? null,
    identity: { repositoryUrl: target.repositoryUrl },
    audit: deriveAuditEvidence(bountyFields),
    actionability,
    researchReadiness,
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

// --- Paginated feed -----------------------------------------------------

export const SECURITY_TARGET_SORT_FIELDS = ["slug", "lastSignalAt"] as const;
export type SecurityTargetSortField = (typeof SECURITY_TARGET_SORT_FIELDS)[number];

/**
 * Validates and applies defaults to raw Security Target Feed query input
 * — mirrors `opportunityFeedQuerySchema`'s role exactly. `tier`/
 * `readiness` reuse the same closed vocabularies `security-priority.ts`
 * already defines (`SECURITY_TARGET_PRIORITY_TIERS`/
 * `SECURITY_TARGET_RESEARCH_READINESS_STATUSES`) rather than a second,
 * parallel enum.
 */
export const securityTargetFeedQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  tier: z.enum(SECURITY_TARGET_PRIORITY_TIERS).optional(),
  readiness: z.enum(SECURITY_TARGET_RESEARCH_READINESS_STATUSES).optional(),
  sort: z.enum(SECURITY_TARGET_SORT_FIELDS).default("slug"),
});
export type SecurityTargetFeedQuery = z.infer<typeof securityTargetFeedQuerySchema>;

/**
 * Phase 1 batch inputs: the minimal, set-oriented data needed to derive
 * `tier`, `researchReadiness.status`, `hasOpportunity`, and
 * `lastSignalAt` for *every* Security Target at once — deliberately
 * narrower than the full per-target composition `buildSecurityTargetPriority`
 * performs, and deliberately never retained past this classification
 * step (no asset descriptions, no audit entries, no Opportunity
 * reasoning are read here at all).
 */
interface LightweightBountyFields {
  endDate: string | null;
  smartContractAssetCount: number;
}

/** Every Signal's `(securityTargetId, signalType)` — one query, every target. Duplicates per target are expected (multiple polls) and are exactly what `securityTargetPriorityTier`'s own de-duplication already handles; not de-duplicated here. */
async function getSignalTypesByTarget(): Promise<Map<string, string[]>> {
  const rows = await getDb()
    .select({
      securityTargetId: schema.securitySignal.securityTargetId,
      signalType: schema.securitySignal.signalType,
    })
    .from(schema.securitySignal);

  const map = new Map<string, string[]>();
  for (const row of rows) {
    const list = map.get(row.securityTargetId);
    if (list) {
      list.push(row.signalType);
    } else {
      map.set(row.securityTargetId, [row.signalType]);
    }
  }
  return map;
}

/** Every Immunefi Bug Bounty's `status` by target — one query, every target. Only the one column `computeIsActionable` needs. */
async function getBugBountyStatusByTarget(): Promise<Map<string, BugBountyStatus>> {
  const rows = await getDb()
    .select({
      securityTargetId: schema.bugBounty.securityTargetId,
      status: schema.bugBounty.status,
    })
    .from(schema.bugBounty)
    .where(eq(schema.bugBounty.platform, IMMUNEFI_PLATFORM));

  const map = new Map<string, BugBountyStatus>();
  for (const row of rows) {
    if (row.securityTargetId) {
      map.set(row.securityTargetId, row.status);
    }
  }
  return map;
}

/**
 * The latest bounty-program Event per target, batched via `DISTINCT ON`
 * — the same "most recently captured wins, ordered by `event.recordedAt`"
 * semantics `getLatestBountyProgramFields` uses for one target (see its
 * doc comment for why `recordedAt`, not `occurredAt` or `id`, is the
 * correct column), applied across all of them in a single query (mirrors
 * the `DISTINCT ON` pattern `packages/ingestion`'s
 * `reconcileMissingRecords` already uses for "latest row per key").
 * `parseBountyEventMetadata` is reused unmodified; only `endDate` and the
 * smart-contract asset *count* are kept in the returned map — the full
 * `assets[]`/`audits[]` the parser also produces are discarded
 * immediately after this function reads the two fields it needs, never
 * retained in the classification map.
 */
async function getLatestBountyFieldsLightweightByTarget(): Promise<
  Map<string, LightweightBountyFields>
> {
  const rows = await getDb()
    .selectDistinctOn([schema.event.relatedEntityId], {
      securityTargetId: schema.event.relatedEntityId,
      metadata: schema.event.metadata,
    })
    .from(schema.event)
    .where(
      and(
        eq(schema.event.relatedEntityType, "security_target"),
        inArray(schema.event.type, [BountyProgramRecorded.name, BountyProgramUpdated.name]),
      ),
    )
    .orderBy(schema.event.relatedEntityId, desc(schema.event.recordedAt), desc(schema.event.id));

  const map = new Map<string, LightweightBountyFields>();
  for (const row of rows) {
    if (!row.securityTargetId) {
      continue;
    }
    const parsed = parseBountyEventMetadata(row.metadata);
    map.set(row.securityTargetId, {
      endDate: parsed?.endDate ?? null,
      smartContractAssetCount: parsed?.smartContractAssetIds.length ?? 0,
    });
  }
  return map;
}

/** Which targets have *any* Security Opportunity row — one existence-only query, every target. Never reads `reasoning`/`detectedAt`/`detectionWindow` — those are Phase-2-only (`opportunityReasoning`). */
async function getTargetsWithOpportunity(): Promise<Set<string>> {
  const rows = await getDb()
    .selectDistinct({ securityTargetId: schema.securityOpportunity.securityTargetId })
    .from(schema.securityOpportunity);
  return new Set(rows.map((row) => row.securityTargetId));
}

/** `lastSignalAt` per target — one query, keyed by the table's own primary key (`securityTargetId`), so no `DISTINCT`/ordering is needed. */
async function getLastSignalAtByTarget(): Promise<Map<string, Date | null>> {
  const rows = await getDb()
    .select({
      securityTargetId: schema.securityTargetIntelligence.securityTargetId,
      lastSignalAt: schema.securityTargetIntelligence.lastSignalAt,
    })
    .from(schema.securityTargetIntelligence);
  return new Map(rows.map((row) => [row.securityTargetId, row.lastSignalAt]));
}

interface ClassifiedTarget {
  id: string;
  slug: string;
  tier: SecurityTargetPriorityDTO["tier"];
  readinessStatus: SecurityTargetPriorityDTO["researchReadiness"]["status"];
  hasOpportunity: boolean;
  lastSignalAt: Date | null;
}

function compareBySlug(a: ClassifiedTarget, b: ClassifiedTarget): number {
  return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
}

/**
 * Sorts by `lastSignalAt` descending, nulls last (a target with no
 * Signal history yet sorts after every target that has one, regardless
 * of direction — the same "nulls last" policy `opportunity-query-service.ts`'s
 * `buildOrderBy` already applies to its own nullable sort columns), with
 * `slug` ascending as an explicit, deterministic tie-breaker whenever
 * two targets share a timestamp (including two `null`s).
 */
function compareByLastSignalAtDesc(a: ClassifiedTarget, b: ClassifiedTarget): number {
  const aTime = a.lastSignalAt?.getTime();
  const bTime = b.lastSignalAt?.getTime();
  if (aTime === undefined && bTime === undefined) {
    return compareBySlug(a, b);
  }
  if (aTime === undefined) {
    return 1;
  }
  if (bTime === undefined) {
    return -1;
  }
  if (aTime !== bTime) {
    return bTime - aTime;
  }
  return compareBySlug(a, b);
}

/**
 * The paginated, filtered, sorted Security Target Feed — the approved
 * two-phase design. Phase 1 runs a fixed, small number of batched
 * queries (independent of how many targets exist) to classify every
 * target by `tier`/`researchReadiness.status`/`hasOpportunity`/
 * `lastSignalAt`, using the exact same pure derivation functions
 * (`securityTargetPriorityTier`, `deriveResearchReadiness`,
 * `computeIsActionable`) `listSecurityTargetPriority`'s own
 * `buildSecurityTargetPriority` uses — never a second, independently
 * derived classification. Filtering, sorting, and pagination all happen
 * on this lightweight, in-memory classification *before* Phase 2 runs
 * the full, existing per-target composition — and only for the
 * resulting page's targets, never for every target.
 *
 * `listSecurityTargetPriority()` above is completely untouched by this
 * function: same query, same ordering, same return type, same behavior.
 */
export async function listSecurityTargetPriorityPage(
  query: SecurityTargetFeedQuery,
): Promise<PaginatedResult<SecurityTargetPriorityDTO>> {
  const db = getDb();

  const [
    targetIdentities,
    signalTypesByTarget,
    bountyStatusByTarget,
    lightweightBountyByTarget,
    targetsWithOpportunity,
    lastSignalAtByTarget,
  ] = await Promise.all([
    db
      .select({ id: schema.securityTarget.id, slug: schema.securityTarget.slug })
      .from(schema.securityTarget),
    getSignalTypesByTarget(),
    getBugBountyStatusByTarget(),
    getLatestBountyFieldsLightweightByTarget(),
    getTargetsWithOpportunity(),
    getLastSignalAtByTarget(),
  ]);

  const now = new Date();
  const classified: ClassifiedTarget[] = targetIdentities.map((target) => {
    const signalTypes = signalTypesByTarget.get(target.id) ?? [];
    const { tier, qualifyingSignalTypes } = securityTargetPriorityTier(signalTypes);

    const bountyStatus = bountyStatusByTarget.get(target.id);
    const lightweightBounty = lightweightBountyByTarget.get(target.id);
    const isActionable = computeIsActionable(
      bountyStatus,
      lightweightBounty?.endDate ?? null,
      lightweightBounty?.smartContractAssetCount ?? 0,
      now,
    );

    const { status: readinessStatus } = deriveResearchReadiness({
      isActionable,
      actionableAssetCount: lightweightBounty?.smartContractAssetCount ?? 0,
      qualifyingSignalTypes,
      // Classification only needs `.status` here — `.nextAction`'s
      // example asset is a Phase-2-only, full-DTO concern.
      exampleAsset: null,
    });

    return {
      id: target.id,
      slug: target.slug,
      tier,
      readinessStatus,
      hasOpportunity: targetsWithOpportunity.has(target.id),
      lastSignalAt: lastSignalAtByTarget.get(target.id) ?? null,
    };
  });

  const filtered = classified.filter((c) => {
    if (query.tier !== undefined && c.tier !== query.tier) {
      return false;
    }
    if (query.readiness !== undefined && c.readinessStatus !== query.readiness) {
      return false;
    }
    return true;
  });

  const sorted = [...filtered].sort(
    query.sort === "lastSignalAt" ? compareByLastSignalAtDesc : compareBySlug,
  );

  const totalCount = sorted.length;
  const totalPages = totalCount === 0 ? 0 : Math.ceil(totalCount / query.pageSize);
  const startIndex = (query.page - 1) * query.pageSize;
  const pageSlice = sorted.slice(startIndex, startIndex + query.pageSize);

  // Phase 2: the full, existing per-target composition — only for the
  // selected page's targets, never for the full set classified above.
  const pageTargetRows =
    pageSlice.length > 0
      ? await db
          .select()
          .from(schema.securityTarget)
          .where(
            inArray(
              schema.securityTarget.id,
              pageSlice.map((c) => c.id),
            ),
          )
      : [];
  const pageTargetById = new Map(pageTargetRows.map((row) => [row.id, row]));

  const items = await Promise.all(
    pageSlice.map((c) => buildSecurityTargetPriority(pageTargetById.get(c.id)!)),
  );

  return {
    items,
    page: query.page,
    pageSize: query.pageSize,
    totalCount,
    totalPages,
  };
}

/**
 * Single-target lookup for the detail view — resolves through the same
 * canonical slug lookup every other consumer uses
 * (`getSecurityTargetBySlug`), then runs the exact same, unmodified
 * per-target composition `listSecurityTargetPriority` uses for every
 * row. No second, detail-specific DTO builder: the returned shape is
 * byte-for-byte what `listSecurityTargetPriority`/`listSecurityTargetPriorityPage`
 * would produce for this same target. `null` for an unknown slug is a
 * normal, expected outcome — never thrown.
 */
export async function getSecurityTargetPriorityBySlug(
  slug: string,
): Promise<SecurityTargetPriorityDTO | null> {
  const target = await getSecurityTargetBySlug(slug);
  if (!target) {
    return null;
  }
  return buildSecurityTargetPriority(target);
}
