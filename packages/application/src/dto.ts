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

/** See `packages/application/src/job-relevance.ts` for the scoring rule, the weights, and why each component excludes itself rather than penalizing missing data. */
export type JobRelevanceTierDTO = "high" | "medium" | "low";

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
