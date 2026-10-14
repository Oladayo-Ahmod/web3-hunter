/**
 * Stable, API-facing shapes owned by the Application Layer
 * (docs/ARCHITECTURE.md §3, §6). These are deliberately distinct from
 * `@web3-hunter/db`'s row types: every field here is JSON-serializable
 * (dates as ISO strings), and only fields the UI/API actually needs are
 * exposed — no raw database row is ever handed to a consumer of this
 * package.
 */

export type OpportunityStatusDTO = "detected" | "scored";

export type IntelligenceTrendDTO = "insufficient-data" | "increasing" | "stable" | "decreasing";

export interface CompanySummaryDTO {
  id: string;
  slug: string;
  name: string;
  /** `null` when the Company has no curated `careersPageUrl` (Milestone 11) — never fabricated from `websiteUrl`. */
  careersPageUrl: string | null;
  websiteUrl: string | null;
  /** Milestone 22's startup-bias signal, carried through to every surface that shows a Company summary — see `company.priority`'s own doc comment. */
  priority: CompanyPriorityDTO | null;
}

export interface SignalSummaryDTO {
  id: string;
  signalType: string;
  weight: number;
  reasoning: string;
  detectedAt: string;
}

export interface CompanyIntelligenceSummaryDTO {
  trend: IntelligenceTrendDTO;
  confidence: number;
  signalCount: number;
  lastSignalAt: string | null;
  /** The point in (event) time this Intelligence snapshot reflects. */
  asOf: string;
}

export interface SkillDTO {
  id: string;
  slug: string;
  name: string;
}

/**
 * The fit assessment between the viewing User and one Opportunity —
 * present only when the caller supplied a `viewerId` and a Match has been
 * computed for that pair (docs/DOMAIN_MODEL.md's *Match ≠ Score*: the
 * score alone is never returned without the Skills that produced it).
 * `matchedTechnologySkills` (Milestone 9) is the subset of the
 * Opportunity's Company's GitHub-evidenced technologies the viewer also
 * declared — empty both when there was no overlap and when the Company
 * has no Technology Profile yet; `reasoning` is what distinguishes those
 * two cases in words.
 */
export interface MatchSummaryDTO {
  score: number;
  reasoning: string;
  matchedSkills: SkillDTO[];
  matchedTechnologySkills: SkillDTO[];
}

/**
 * A Company's current, deterministic Technology Profile (Milestone 9):
 * the Skills its own GitHub activity evidences. `null` at every call site
 * that surfaces it means "no Technology Profile yet" — never an empty
 * list standing in for that, so the UI can distinguish "no GitHub
 * evidence collected" from "collected, evidences nothing in our
 * taxonomy."
 */
export interface CompanyTechnologyProfileDTO {
  technologies: SkillDTO[];
  evidenceCount: number;
  asOf: string;
}

export interface OpportunityFeedItemDTO {
  id: string;
  company: CompanySummaryDTO;
  opportunityType: string;
  status: OpportunityStatusDTO;
  score: number | null;
  detectionWindow: string;
  detectedAt: string;
  scoredAt: string | null;
  match: MatchSummaryDTO | null;
}

/**
 * A cached AI-generated artifact, as surfaced to a consumer — `null`
 * means no artifact has been generated yet (AI unavailable, or simply
 * never requested), never an error. Deliberately thin: version/model
 * metadata is included so the UI can label content as AI-generated, but
 * `packages/application` never re-renders or re-interprets the content
 * itself — that's `packages/ai`'s job, this is a read of what it already
 * produced.
 */
export interface AIArtifactSummaryDTO {
  content: string;
  version: number;
  generatedAt: string;
}

export interface OpportunityDetailDTO extends OpportunityFeedItemDTO {
  reasoning: string;
  /**
   * The Company's full Signal history, which is exactly what
   * `packages/scoring`'s Scoring Engine v1 used to compute this
   * Opportunity's current score (docs/ROADMAP.md Milestone 3) — this list
   * is the literal evidence behind the score, not an approximation of it.
   */
  signals: SignalSummaryDTO[];
  companyIntelligence: CompanyIntelligenceSummaryDTO | null;
  freshness: {
    lastSignalAt: string | null;
    asOf: string | null;
  };
  /**
   * Milestone 9: this Opportunity's Company's current Technology Profile,
   * surfaced in the Opportunity's context — not independent evidence of
   * its own. Per the approved Milestone 9 design, an Opportunity has no
   * per-opportunity technology evidence yet (that would require parsing
   * job descriptions), so this is always exactly its Company's profile,
   * never a distinct computation.
   */
  companyTechnologyProfile: CompanyTechnologyProfileDTO | null;
  /** AI-generated, supplemental — the deterministic fields above remain authoritative whether or not this is present (docs/ROADMAP.md Milestone 7). */
  aiSummary: AIArtifactSummaryDTO | null;
}

export interface CompanyProfileDTO {
  company: CompanySummaryDTO;
  intelligence: CompanyIntelligenceSummaryDTO | null;
  /**
   * Every Opportunity detected for this Company. There is no
   * archived/expired Opportunity state yet (docs/DATABASE.md §Opportunity
   * lifecycle), so "active" currently means "all of them."
   */
  activeOpportunities: OpportunityFeedItemDTO[];
  recentSignals: SignalSummaryDTO[];
  /** Milestone 9: see `OpportunityDetailDTO.companyTechnologyProfile` — the same projection, read directly here rather than via an Opportunity. */
  technologyProfile: CompanyTechnologyProfileDTO | null;
  /** AI-generated, supplemental — see `OpportunityDetailDTO.aiSummary`. */
  aiSummary: AIArtifactSummaryDTO | null;
}

/** See `packages/application/src/job-freshness.ts` for the bucketing rule and why it's based on `updatedAt`, not `postedAt` or our own fetch time. */
export type JobFreshnessDTO = "fresh" | "recent" | "aging" | "stale";

/** See `packages/application/src/job-relevance.ts` for the scoring rule, the weights, and why each component excludes itself rather than penalizing missing data. `"very-low"` (Milestone 13 Phase A) is distinct from `"low"` — the tier is computed from the pre-clamp score, so a plain unmatched job and a job with two independent negative signals (e.g. an incompatible role *and* a negative keyword) don't collapse into the same bucket just because both display "0%". */
export type JobRelevanceTierDTO = "high" | "medium" | "low" | "very-low";

export interface JobRelevanceBreakdownEntryDTO {
  label: string;
  weight: number;
}

/**
 * A Job's fit against the *viewing User's* Profile — present only when a
 * `viewerId` was supplied and that User has a Profile (mirrors
 * `MatchSummaryDTO`'s equivalent role for Opportunities: the score is
 * never returned without the evidence that produced it).
 */
export interface JobRelevanceDTO {
  score: number;
  tier: JobRelevanceTierDTO;
  breakdown: JobRelevanceBreakdownEntryDTO[];
  matchedSkills: SkillDTO[];
}

/**
 * An open job posting, derived at read time from the Event log
 * (`JobPosted`/`JobUpdated`/`JobClosed` — see
 * `packages/collectors/src/hiring-events.ts`), not a persisted table
 * (docs/ROADMAP.md Milestone 12, Phase 3: "inspect whether the existing
 * Event/read-model architecture already contains what's needed before
 * introducing new domain models" — it did).
 *
 * `id` is a deterministic composite (`${companyId}:${externalId}`), not a
 * database-generated UUID, since there's no persisted row to generate one
 * from — the same pair always produces the same `id`, which is what a
 * detail-page URL needs.
 *
 * Fields are exactly what `JobFields` captures — nothing here is inferred
 * or fabricated. `description`/`employmentType`/`workplaceType` are
 * `null` whenever the source genuinely doesn't provide them (Greenhouse
 * has no structured employment/workplace type at all — see
 * `packages/collectors/src/greenhouse/normalize.ts`), never a guess.
 * Salary remains absent entirely — no Collector captures it.
 */
export interface JobFeedItemDTO {
  id: string;
  externalId: string;
  title: string;
  locationName: string | null;
  departmentNames: string[];
  absoluteUrl: string;
  /** Plain text. `null` if the source didn't provide one, or this Event predates capturing it (see `JobFields`' doc comment). */
  description: string | null;
  employmentType: "full-time" | "part-time" | "contract" | "internship" | null;
  workplaceType: "remote" | "hybrid" | "onsite" | null;
  company: CompanySummaryDTO;
  /** Always `"open"` today — this read model only ever returns currently-open postings (see `job-query-service.ts`'s `open_jobs` CTE). A literal, not a boolean, so an "include closed" view (Milestone 13, deferred) is additive, not a breaking type change. */
  status: "open";
  /** When this posting first appeared (its `JobPosted` Event's `occurredAt` — the source's own timestamp at first discovery, not our fetch time). */
  postedAt: string;
  /** When this posting's state last changed (its latest `JobPosted`/`JobUpdated` Event's `occurredAt`, i.e. the source's own last-modified timestamp) — equal to `postedAt` if it has never been updated. This, not `postedAt`, is what `freshness` is computed from. */
  updatedAt: string;
  freshness: JobFreshnessDTO;
  /** Milestone 13 Phase 2 — this Job's own classified Skills (`job_skill`), independent of whether a viewer is present. Empty, not absent, when classification hasn't run yet or found nothing. */
  detectedSkills: SkillDTO[];
  relevance: JobRelevanceDTO | null;
}

export interface PaginatedResult<T> {
  items: T[];
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
}

export interface SearchResultDTO {
  companies: CompanySummaryDTO[];
  opportunities: OpportunityFeedItemDTO[];
}

export interface TargetRoleDTO {
  slug: string;
  name: string;
}

/** The current state of a User's Profile — for pre-filling the profile-editing form. */
export interface UserProfileSummaryDTO {
  skills: SkillDTO[];
  dealBreakerSkills: SkillDTO[];
  /** Milestone 13 Phase 2 — job-hunt preferences `job-relevance.ts` reads. Every field is independently optional; see that module's doc comment for how "not set" is scored. */
  targetRoles: TargetRoleDTO[];
  remotePreference: "remote_only" | "remote_friendly" | "no_preference" | null;
  locationConstraint: string | null;
  seniorityPreference: string[];
  /** AI-generated, supplemental — see `OpportunityDetailDTO.aiSummary`. */
  aiInsight: AIArtifactSummaryDTO | null;
}

export type RecommendationStatusDTO = "active" | "dismissed" | "archived" | "expired";

/**
 * The Decision Engine's determination that a Match is worth surfacing —
 * authenticated-only, always scoped to the requesting User (never another
 * User's). `reason` is rendered, human-readable wording assembled here
 * from the deterministic `reasonCode`/`reasonDetails` `packages/decision`
 * stores — per the Milestone 6 refinement, the Application Layer owns
 * presentation, the Decision Engine owns the structured fact.
 */
export interface RecommendationSummaryDTO {
  id: string;
  status: RecommendationStatusDTO;
  priority: number;
  reason: string;
  createdAt: string;
  statusChangedAt: string;
  opportunity: OpportunityFeedItemDTO;
  /** AI-generated, supplemental — see `OpportunityDetailDTO.aiSummary`. */
  aiExplanation: AIArtifactSummaryDTO | null;
}

export interface RecommendationDetailDTO extends Omit<RecommendationSummaryDTO, "opportunity"> {
  opportunity: OpportunityDetailDTO;
  /** AI-generated, supplemental — see `OpportunityDetailDTO.aiSummary`. */
  aiOutreachDraft: AIArtifactSummaryDTO | null;
}

export type CollectorStatusDTO = "configured" | "active" | "degraded" | "disabled";

/**
 * Collector Health, per Milestone 8: a read-only operational snapshot of
 * one Collector's most recent run — storage + read API only, no dashboard.
 * `lastRunAt`/`lastErrorAt` describe the last *successful* and last
 * *failed* run respectively (independent timestamps, since the most
 * recent run of each kind isn't necessarily the same run); the
 * `lastRun*` fields describe the single most recent run regardless of
 * outcome.
 */
export interface CollectorHealthDTO {
  id: string;
  slug: string;
  sourceType: string;
  status: CollectorStatusDTO;
  consecutiveFailures: number;
  lastRunAt: string | null;
  lastErrorAt: string | null;
  lastErrorMessage: string | null;
  lastRunRecordsProcessed: number | null;
  lastRunRecordsPublished: number | null;
  lastRunDurationMs: number | null;
}

export type PipelineRunStatusDTO = "succeeded" | "failed";

/**
 * Pipeline Run — the execution-history counterpart to
 * `CollectorHealthDTO`, per Milestone 10: a read-only record of one
 * invocation of Scoring/Classification/Technology/Matching/Decision —
 * storage + read API only, no dashboard. Unlike Collector Health (one
 * mutable snapshot per Collector), this is a log entry: one row per
 * invocation, since these pipelines run once per Company/Opportunity/User,
 * repeatedly, not once per singular source. `metrics` is `null` on
 * failure; `errorMessage` is `null` on success.
 */
export interface PipelineRunDTO {
  id: string;
  pipelineName: string;
  scopeType: string;
  scopeId: string;
  status: PipelineRunStatusDTO;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  metrics: Record<string, unknown> | null;
  errorMessage: string | null;
}

export type CompanyPriorityDTO = "high" | "medium" | "low";

export type CompanyContactRoleDTO =
  | "founder"
  | "cofounder"
  | "cto"
  | "head_of_engineering"
  | "security_lead"
  | "protocol_lead"
  | "other";

/**
 * A named, individually-verified person worth contacting at an Outreach
 * Target Company — `company_contact`'s DTO. Never a placeholder: a row
 * only exists because a real profile was found (Milestone 17).
 */
export interface CompanyContactDTO {
  name: string;
  role: CompanyContactRoleDTO;
  profileUrl: string;
  notes: string | null;
}

/**
 * The single strongest reason to reach out to an Outreach Target Company
 * today — Milestone 17's four-section UX (docs: "WHO SHOULD I CONTACT
 * TODAY"). Every Company `listOutreachTargets` returns gets exactly one,
 * chosen by `outreach-query-service.ts`'s fixed precedence: an open role
 * is always the strongest, most actionable reason (apply now); otherwise
 * a stated recent funding round; otherwise a hand-curated "high priority"
 * judgment call; otherwise it's still worth a speculative outreach.
 */
export type OpportunityTypeDTO =
  "OPEN_ROLE" | "RECENTLY_FUNDED" | "HIGH_PRIORITY_STARTUP" | "SPECULATIVE_OUTREACH";

/**
 * One row of the Outreach Target list — "who should I contact today"
 * (Milestone 17). Deliberately not a `CompanyProfileDTO` extension: this
 * view exists to answer a different question (who to contact and why),
 * not to describe a Company's full intelligence profile.
 */
export interface OutreachTargetDTO {
  id: string;
  slug: string;
  name: string;
  websiteUrl: string | null;
  careersPageUrl: string | null;
  twitterUrl: string | null;
  linkedinUrl: string | null;
  description: string | null;
  category: string | null;
  tags: string[];
  priority: CompanyPriorityDTO | null;
  fundingStage: string | null;
  /** Milestone 18 §6 — a verified attribute, not a score; see `company.recentlyFunded`'s doc comment. */
  recentlyFunded: boolean;
  fundingDate: string | null;
  fundingAmount: string | null;
  fundingSource: string | null;
  opportunityType: OpportunityTypeDTO;
  openJobCount: number;
  /** Up to 3 currently-open job titles at this Company — Milestone 18 §9's "role if available," so an Outreach card doesn't require a click-through just to see what's open. */
  openJobTitles: string[];
  /** When a real hiring Signal (`company_intelligence.lastSignalAt`) was last detected for this Company — `null` if none ever has been. The freshness signal DM/Research ranking sorts by, since `priority`/funding alone are static, curator-set facts that would otherwise never change. */
  lastSignalAt: string | null;
  /** A short, deterministic (never AI-generated) sentence explaining why this Company is on the list today — derived from `opportunityType`/`priority`/funding, not a new scoring input. */
  reasonToContact: string;
  contacts: CompanyContactDTO[];
}

/**
 * One row of the "Apply" section of the Today Digest (Milestone 19 §6) —
 * a real, clickable, eligible blockchain/Web3 engineering role, at any
 * Company (no longer gated on a curated `priority` tag — see
 * `daily-digest-service.ts`'s `fetchApplyCandidates` doc comment).
 * Deliberately smaller than `JobFeedItemDTO`: this view only needs enough
 * to decide "should I click apply," not the full Job Detail page's
 * skill/relevance breakdown.
 */
export interface TodayApplyJobDTO {
  id: string;
  title: string;
  companySlug: string;
  companyName: string;
  companyPriority: CompanyPriorityDTO | null;
  absoluteUrl: string;
  locationName: string | null;
  workplaceType: "remote" | "hybrid" | "onsite" | null;
  postedAt: string;
  freshness: JobFreshnessDTO;
  /** `null` when there's no viewer Profile to score against — never a fabricated "0". */
  relevanceScore: number | null;
}

/**
 * "What should I do today" (Milestone 19 §6) — the whole point of this
 * product per its last three governing directives. Three fixed-size,
 * already-ranked lists built entirely from `listJobFeed`/
 * `listOutreachTargets`'s own data; no new scoring subsystem, no AI.
 */
/**
 * `CollectorHealthDTO` (above) plus one derived field — whether this
 * Collector's own health data is older than its expected cadence allows
 * (Milestone 24, governing directive Part 8). A separate, wrapping type
 * rather than adding `isStale` directly onto `CollectorHealthDTO` itself:
 * that DTO's only mapper, `toCollectorHealthDTO`, is a pure "flatten one
 * `collector` row" function with no knowledge of scheduling — staleness
 * needs each Collector's *own* cadence (job Collectors vs. `github`),
 * which is a `pipeline-health-service.ts` concern, not a row-mapping one.
 */
export interface CollectorHealthWithFreshnessDTO extends CollectorHealthDTO {
  isStale: boolean;
}

/**
 * Data-freshness as a first-class, observable fact (Milestone 24,
 * governing directive Part 8) — "the system must not silently become
 * stale." `jobsLastRefreshedAt` is the single most important field: the
 * most recent `JobPosted`/`JobUpdated` Event timestamp across the entire
 * `event` table, independent of any one Collector's self-reported
 * health, so it reflects what actually landed in the database rather
 * than what a Collector merely claims to have done.
 */
export interface PipelineHealthDTO {
  jobsLastRefreshedAt: string | null;
  /** True when `jobsLastRefreshedAt` is older than the acceptable staleness threshold — see `pipeline-health-service.ts`. */
  jobsAreStale: boolean;
  collectors: CollectorHealthWithFreshnessDTO[];
}

export interface TodayDigestDTO {
  applyJobs: TodayApplyJobDTO[];
  dmTargets: OutreachTargetDTO[];
  researchTargets: OutreachTargetDTO[];
}

/** See `packages/application/src/security-priority.ts` for the tier rule. `"C"` is a real, legitimate result — a discovered Security Target with no qualifying Signal yet, not an omission. */
export type SecurityTargetPriorityTierDTO = "A" | "B" | "C";

/**
 * Identity evidence for a Security Target, represented honestly: `null`
 * means this target genuinely has no stored value for that field (either
 * no source ever supplied one, or — for `repositoryUrl` — it was never
 * backfilled; see `packages/security/src/security-target-store.ts`'s
 * `updateSecurityTargetRepositoryUrlIfMissing`), never a guess.
 *
 * `websiteUrl`/`twitterUrl` are read straight from each source's own
 * already-captured raw payload (DefiLlama's `url`/`twitter`, falling
 * back to Immunefi's `websiteUrl` when DefiLlama has none) — no new
 * external request is made to produce them; see
 * `security-target-query-service.ts`'s `getDefiLlamaIdentityEnrichment`
 * doc comment for the exact precedence rule and why.
 */
export interface SecurityTargetIdentityEvidenceDTO {
  repositoryUrl: string | null;
  websiteUrl: string | null;
  twitterUrl: string | null;
}

/**
 * DefiLlama's own reported Total Value Locked for this target, read from
 * the latest `ProtocolSnapshotRecorded`/`Updated` Event — `null` whenever
 * no DefiLlama protocol-snapshot Event has ever been recorded (e.g. an
 * Immunefi-only target) or DefiLlama itself reports no TVL. `asOf` is the
 * triggering Event's own `occurredAt` (DefiLlama's own snapshot time,
 * never wall-clock "now"), so a stale figure is identifiable as such
 * rather than implied to be current. `change1d`/`change7d` are DefiLlama's
 * own reported percentage changes, passed through verbatim — never
 * recomputed from successive snapshots here.
 */
export interface SecurityTargetProtocolMetricsDTO {
  tvlUsd: number | null;
  change1dPercent: number | null;
  change7dPercent: number | null;
  asOf: string | null;
}

/**
 * One preserved Immunefi audit-history entry, exactly as the source
 * supplied it (see `packages/collectors/src/bounty-program-events.ts`'s
 * `BountyAuditFields`) — never interpreted. `auditor`/`url`/`date` are
 * `null` when the source itself omitted them (a real, observed state —
 * Immunefi's own audit entries vary in completeness), not when the whole
 * audit record is missing.
 */
export interface SecurityTargetAuditEntryDTO {
  id: string;
  auditor: string | null;
  url: string | null;
  date: string | null;
}

/**
 * Audit evidence for a Security Target, with its availability stated
 * explicitly rather than collapsed into a count:
 * - `"unavailable"`: no bounty-program source Event has ever been
 *   recorded for this target — there is no Immunefi data to say anything
 *   about audits one way or the other.
 * - `"none"`: a bounty-program Event exists, and it recorded zero audits.
 * - `"present"`: at least one audit entry is on record.
 *
 * `limitation` is carried on every result, including `"present"` — see
 * `BountyAuditFields`' own doc comment: an audit record's existence never
 * confirms it covers the currently deployed code, that it is recent, or
 * that the target is otherwise secure. Nothing that reads this DTO should
 * imply any of those.
 */
export interface SecurityTargetAuditEvidenceDTO {
  status: "unavailable" | "none" | "present";
  entries: SecurityTargetAuditEntryDTO[];
  limitation: string;
  /**
   * Bare audit-report URLs DefiLlama lists for this target (its own
   * `audit_links` field) — distinct from `entries`, which are Immunefi's
   * structured, attributed audit records. These carry no auditor name or
   * date, only a link, and are never merged into `entries` so the two
   * evidence qualities are never confused. Always `[]` when DefiLlama
   * reports zero audits for this target — which, by construction, is
   * every target whose only qualifying signal is `audit-coverage-gap`
   * (that signal requires DefiLlama's own audit count to be zero, so
   * DefiLlama never supplies links in that exact case either).
   */
  defiLlamaAuditLinks: string[];
}

/**
 * One in-scope smart-contract asset, exactly as the source described it
 * — never interpreted, never ranked. `description`/`url` are `null` only
 * when the source itself omitted them, not when the whole asset record
 * is missing.
 */
export interface SecurityTargetScopeAssetDTO {
  id: string;
  description: string | null;
  url: string | null;
}

/**
 * Whether there is a concrete next step for a security researcher today —
 * deliberately distinct from "this target has a bug bounty," which alone
 * is not actionable (a bounty with an empty or out-of-scope asset list
 * gives nothing specific to review, and a concluded competition gives
 * nothing current to review even if `bug_bounty.status` still reads
 * "active" — see `isBountyProgramExpired`'s doc comment in
 * `@web3-hunter/security` for why that status alone cannot tell). `true`
 * only when an active, not-yet-concluded bounty program currently lists
 * at least one smart-contract asset in scope.
 */
export interface SecurityTargetActionabilityDTO {
  isActionable: boolean;
  reason: string;
  /**
   * The Immunefi bounty program's own page, read directly from the
   * stored `bug_bounty.scopeUrl` — present whenever a Bug Bounty row
   * exists for this target, regardless of current status, since it is a
   * traceability link to the source, not a claim about eligibility.
   * `null` only when no Bug Bounty row is on record at all.
   */
  scopeUrl: string | null;
  /**
   * Every currently in-scope smart-contract asset backing `isActionable`,
   * in the source's own order — never sorted, never ranked, and never
   * implying any one asset is more important or more likely vulnerable
   * than another. Empty whenever `isActionable` is false, or when the
   * triggering Event's `assets` metadata is missing (never fabricated
   * from `smartContractAssetIds` alone — see
   * `security-target-query-service.ts`'s `getLatestBountyProgramFields`).
   */
  assets: SecurityTargetScopeAssetDTO[];
  /** Equals `assets.length` today — a separate field so a future cap on `assets` can stay honest about the real total. */
  totalAssetCount: number;
}

/** See `packages/application/src/security-priority.ts`'s `deriveResearchReadiness` doc comment for the full rule and why each status means what it does. */
export type SecurityTargetResearchReadinessStatusDTO =
  "ready" | "insufficient-evidence" | "no-current-route";

/**
 * A third, independent dimension alongside `tier` (historical: what
 * changed) and `actionability` (current: is there a verified live
 * route) — whether available evidence currently supports a concrete
 * research action. Deliberately not a score: `status` is explained by
 * `reason`, and `nextAction` is populated only for `"ready"`, grounded
 * strictly in already-known scope/asset counts — never a fabricated
 * asset name, contract address, or audit conclusion.
 */
export interface SecurityTargetResearchReadinessDTO {
  status: SecurityTargetResearchReadinessStatusDTO;
  reason: string;
  nextAction: string | null;
}

/**
 * One of this Collector's two checked locations (RFC 9116
 * `security.txt`, GitHub's own Community Profile `SECURITY.md` check) —
 * `null` means "never checked yet" (no Security Disclosure Collector run
 * has covered this target), distinct from `found: false` ("checked, and
 * the resource genuinely doesn't exist"). Never conflate the two:
 * "not checked" carries no information about whether a route exists;
 * "checked, not found" is itself real, timestamped evidence.
 */
export interface SecurityTargetDisclosureRouteDTO {
  found: boolean;
  /** The exact URL this Collector fetched — always present, whether or not it was `found`, so the UI can show what was actually checked. */
  sourceUrl: string;
  /** When this route was first observed in its current `found` state — the earliest stored observation, never recomputed or guessed. */
  discoveredAt: string;
  /** When this route's recorded state last genuinely changed — equal to `discoveredAt` if it never has. Not "last time we checked": an unchanged re-check produces no new Event (see `security-disclosure-events.ts`'s dedup discipline), so this reflects the last *change*, the same honest semantics `lastSignalAt` already uses elsewhere in this DTO. */
  lastChangedAt: string;
  /** RFC 9116 `Contact:` values, in the source's own preference order — always `[]` for the GitHub route, which has no equivalent field. */
  contacts: string[];
  /** Where the disclosure policy itself is published — `security.txt`'s `Policy:` value, or the `SECURITY.md` page's own URL for the GitHub route. */
  policyUrl: string | null;
  /** `security.txt`'s `Canonical:` value only — always `null` for the GitHub route. */
  canonicalUrl: string | null;
  /** `security.txt`'s own `Expires:` value, exactly as published — always `null` for the GitHub route. */
  expires: string | null;
  /** Derived at read time from `expires` vs. now — `false` whenever `expires` is `null` (no staleness claim can be made without one). Never implies the route is gone, only that its publisher's own staleness marker has passed. */
  isExpired: boolean;
}

/**
 * Both of the Security Disclosure Collector's checked routes for one
 * target — `null` per field when that specific check has never run for
 * this target (see `SecurityTargetDisclosureRouteDTO`'s doc comment on
 * why that's distinct from "checked, not found").
 */
export interface SecurityTargetDisclosureEvidenceDTO {
  securityTxt: SecurityTargetDisclosureRouteDTO | null;
  githubSecurityPolicy: SecurityTargetDisclosureRouteDTO | null;
}

/** See `packages/application/src/security-priority.ts`'s `deriveResearchRoute` doc comment for the full rule. */
export type SecurityTargetResearchRouteDTO =
  "verified-bounty" | "disclosure-available" | "repository-research" | "needs-discovery";

/**
 * The practical "where do I actually go" classification, independent of
 * `researchReadiness`'s evidence-based status — see `deriveResearchRoute`.
 * Always present, even for `"needs-discovery"`, so the UI never has to
 * infer a next step from the absence of one.
 */
export interface SecurityTargetResearchRouteResultDTO {
  route: SecurityTargetResearchRouteDTO;
  nextAction: string;
}

/**
 * One row of the Security Research Prioritization view (the approved
 * design) — composed read-time from a Security Target's Signals,
 * Intelligence projection, Opportunity existence, and preserved Immunefi
 * audit/bounty evidence. No numeric score: `tier` is ordinal and
 * explained by `tierReason`, per the design's explicit "do not introduce
 * numeric weights without a validation basis."
 *
 * A target with `tier: "C"` and `hasOpportunity: false` is a real,
 * expected result (a discovered target with no qualifying Signal yet),
 * never filtered out — see `security-target-query-service.ts`'s
 * `listSecurityTargetPriority`.
 */
export interface SecurityTargetPriorityDTO {
  id: string;
  slug: string;
  name: string;
  tier: SecurityTargetPriorityTierDTO;
  tierReason: string;
  /** Distinct, sorted Signal types observed for this target that qualify it for an Opportunity — empty for Tier C. */
  qualifyingSignalTypes: string[];
  /**
   * The `security_signal.id` of every Signal whose type qualifies for an
   * Opportunity (`doesSignalTypeQualifyForOpportunity` — the same rule
   * `qualifyingSignalTypes` is derived from), sorted by `(detectedAt,
   * id)` for determinism. Empty for Tier C. Deliberately **not** derived
   * from `event_provenance`: the `SecurityOpportunityDetected` Event's
   * own provenance cites every Signal for the target, qualifying or not
   * (see `security-opportunity-evaluation.ts`'s `evaluateSecurityOpportunity`)
   * — using it here would leak non-qualifying Signal ids.
   */
  qualifyingSignalIds: string[];
  /**
   * The stored `security_opportunity.reasoning` for this target's most
   * recently detected Opportunity, passed through verbatim — never
   * rewritten or embellished. `null` whenever `hasOpportunity` is false.
   * When multiple Opportunity rows exist for a target (one per detection
   * window), the most recently detected one wins, deterministically —
   * see `security-target-query-service.ts`'s opportunity query. Citing a
   * qualifying Signal here is evidence a change was observed, never a
   * claim that a vulnerability was found.
   */
  opportunityReasoning: string | null;
  /**
   * The number of distinct triggering Events behind this target's
   * Signals (never the number of Signal rows) — see
   * `security-priority.ts`'s `countDistinctTriggeringEvents`.
   */
  distinctEvidenceEventCount: number;
  /** Reused directly from `security_target_intelligence.lastSignalAt` — never recomputed. `null` if no Intelligence projection exists yet. */
  lastSignalAt: string | null;
  hasOpportunity: boolean;
  identity: SecurityTargetIdentityEvidenceDTO;
  protocolMetrics: SecurityTargetProtocolMetricsDTO;
  audit: SecurityTargetAuditEvidenceDTO;
  actionability: SecurityTargetActionabilityDTO;
  disclosure: SecurityTargetDisclosureEvidenceDTO;
  researchReadiness: SecurityTargetResearchReadinessDTO;
  researchRoute: SecurityTargetResearchRouteResultDTO;
}
