# Milestone 13 — Job-Hunting Pivot

**Status:** proposed, not yet implemented. This document is the design review requested before any code changes — see the "Implementation phases" section for what ships when.

## Why this milestone exists

Milestone 12 proved the ingestion/directory architecture scales (37 companies, 4 collectors, ~540 open jobs, a working job read-model). But the product it produces is still shaped like a company-hiring-signal demo: the primary object a user sees is "Company X has an engineering hiring surge," repeated weekly per company. The actual user — one person aggressively job-hunting in Web3 — needs the primary object to be **a specific job they can act on today**, ranked by relevance to their own profile, with a path to apply and reach out.

This does not require throwing away what exists. Every piece of Milestone 1–12's architecture (Events, Raw Records, Collectors, Scoring, Classification, Matching, Decision, the AI layer) is reused below — most of it unchanged, some of it re-scoped from company-granularity to job-granularity.

---

## 1. Current-state gap analysis

Verified against the current schema and code, not assumed:

| Area | Current state | Gap |
|---|---|---|
| Company universe | 37 companies, 100% directory-gated: a JSON file under `apps/web/data/companies/` → `seed:companies` → `company_source_identity`. Zero auto-discovery path anywhere in the codebase. | Every new company requires an engineer to write a file and reseed. |
| Collectors | `CollectorSourceConfig<TRecord>` (`apps/web/lib/collectors/run-collector.ts`) is already a clean generic interface for ATS-style sources — but it requires a pre-known `sourceIdentifier` per company. GitHub's collector is bespoke, same requirement. | No source shape exists for "fetch a list of jobs that each carry their own company info" (aggregator-style boards). |
| Jobs | Read-time projection over the Event log (`packages/application/src/job-query-service.ts`, Milestone 12) — `JobFields` = `{externalId, title, locationName, departmentNames, absoluteUrl}` only. | No `description`, `employmentType`, `workplaceType` (remote/hybrid/onsite), or `seniority` — none of these are captured by any collector today. |
| Freshness | `occurredAt` on every `JobPosted`/`JobUpdated` event = the **source's own** `updated_at`/`updatedAt` field (confirmed in all three ATS normalizers — `packages/collectors/src/{greenhouse,lever,ashby}/normalize.ts`). | This is a "last edited by the source" timestamp, not "still active." A long-open, rarely-touched requisition can carry a multi-year-old `updated_at` and still be a live posting — this is the exact, now-diagnosed cause of "2007 days old" showing up in the feed. `raw_record.fetchedAt` (our own ingestion timestamp, always reliable) exists but is never consulted for freshness today. |
| Relevance | Zero job-level relevance. `packages/classification`'s `skillKeywordClassifier` already does deterministic title+department keyword matching — but it's a `JobPosted`-event-triggered classifier whose output is stored only against the **Opportunity** (`opportunity_skill`), never against the individual job. | The exact primitive needed for job relevance already exists; it's wired to the wrong granularity. |
| Matching | `packages/matching`'s `computeMatch(userSkillIds, opportunitySkillIds, companyTechnologySkillIds)` is User Skills × **Opportunity** Skills + Company Technology — company-granularity, persisted per user in `match`. | No job-level match exists. |
| User profile | `user_profile` has exactly one substantive field: `dealBreakerSkillIds`. Skills live in `user_skill` (a real join table). | No target-role field, no remote/location preference, no seniority preference. |
| Opportunity identity | `opportunity.id = deterministic(companyId, opportunityType, detectionWindow)`, `detectionWindow` = ISO week (`packages/scoring/src/detection-window.ts`). By design (Milestone 3), a new row every week a company keeps meeting the threshold. Only one `opportunityType` exists: `engineering-hiring-surge` (`packages/scoring/src/detectors/hiring-detectors.ts` is the only detector file). | This is why Anchorage shows up repeatedly — it's working as designed, but the design has no "current state" view, only history. |
| Outreach | `packages/ai` already has a real, working outreach-draft generator (`buildOutreachDraftPrompt`, `packages/ai/src/prompts/outreach-draft-prompt.ts`), grounded in Company/Opportunity/matched-skills/reasoning, wired to a real route (`/api/recommendations/[id]/outreach-draft`) and UI. Its own doc comment already states: *"not addressed to a specific Contact, since Contact has no implemented data source yet."* | Company-level, not job-level. No contact-discovery mechanism exists anywhere — confirmed by repo-wide search. |
| Action layer | `/jobs` (Milestone 12) links straight to `absoluteUrl`. | No Save/Applied/Follow-up state, no tracking. |

**Bottom line:** the gap is real but narrower than a rewrite — it is almost entirely *missing granularity* (company → job) on primitives that already exist, plus two genuinely new things (open-ended discovery, and persisted user action state).

---

## 2. Proposed domain changes

- **Curated vs. Discovered Company** — not a new table. Add a state to the existing `company` row: `discoveryStatus: 'curated' | 'discovered'`. The JSON directory keeps working exactly as today (`upsertCompanyDirectory` already enriches-in-place by slug); it just stops being the only path that can create a `company` row. A new resolution path (job-source-driven) can create a `discoveryStatus: 'discovered'` company from a job posting alone. Curated enrichment (logo, URLs, category) can land on a discovered company later without changing its identity — that's the "enrichment layer, not the boundary" the request asks for.

- **JobSource, generalized** — `CollectorSourceConfig<TRecord>` already *is* the directory-shaped `JobSource`. It gets a sibling, not a replacement: an **Aggregator** shape for sources that return many companies' jobs in one call, each job carrying its own company name. Both shapes normalize into the same `CanonicalJob`/`JobFields` and flow through the same `storeRawRecord` → `runIngestionPipeline` → Event log pipeline unchanged.

- **Job Target** — modeled as an *enriched projection*, not a new Aggregate: today's `JobFeedItemDTO` (Milestone 12) extended with `description`, `employmentType`, `workplaceType`, `seniority` (derived), `freshness`, `status`, `detectedSkills`, `matchScore`/`matchReasons` (once a viewer profile exists), and `associatedOpportunity` (a nullable join to that company's *current* Opportunity, if any). This is exactly what `job-query-service.ts`'s own doc comment already anticipated: *"if this ever needs a dedicated materialized read model... this exact query is what it would run at write time."* No new Aggregate, no new Event types.

- **Job-level Skill tagging** — re-point the existing `skillKeywordClassifier` logic at job granularity (new `job_skill`, structurally identical to `opportunity_skill`) in addition to (not instead of) the existing Opportunity-level tagging. Same classifier, same taxonomy, second output table.

- **Current Company Signal (Mode B de-duplication)** — a new query, `listCurrentCompanySignals`, that collapses `opportunity` history to one row per `(companyId, opportunityType)` — the latest `detectionWindow` only. `listOpportunityFeed` is untouched; this is additive.

- **Contact discovery — deliberately minimal, not automated.** No scraping, no fabricated names. v1 surfaces only what already exists legitimately: the company's own public links (`websiteUrl`, `linkedinUrl`, `twitterUrl` — already on `company`) as "company contact paths." A real named-person lookup (recruiter/hiring-manager) requires a paid third-party enrichment API and a ToS/legal review — that's a build-or-buy decision for you, explicitly flagged as out of scope for Phase 4's first pass rather than guessed at.

- **Job action state (Save/Applied/Follow-up)** — the one genuinely new *persisted* concept, because user action state cannot be a read-time projection. New `job_action` table, one row per `(userId, companyId, externalId)`.

---

## 3. Proposed schema changes

All additive — no destructive migration, matching this project's existing discipline (ADR 0002 was purely additive too).

```sql
-- company: curated vs. discovered
ALTER TABLE company ADD COLUMN discovery_status text NOT NULL DEFAULT 'discovered';
-- (pgEnum 'company_discovery_status': 'curated' | 'discovered')
UPDATE company SET discovery_status = 'curated'; -- all 37 existing rows, same migration

-- user_profile: target roles + preferences (small, non-shared vocab → arrays, not new taxonomy tables)
ALTER TABLE user_profile ADD COLUMN target_role_slugs text[] NOT NULL DEFAULT '{}';
ALTER TABLE user_profile ADD COLUMN remote_preference text; -- 'remote_only' | 'remote_friendly' | 'no_preference'
ALTER TABLE user_profile ADD COLUMN location_constraint text; -- free text, mirrors company.headquarters' precedent
ALTER TABLE user_profile ADD COLUMN seniority_preference text[] NOT NULL DEFAULT '{}';

-- job_skill: opportunity_skill's exact shape, at job granularity
CREATE TABLE job_skill (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES company(id),
  external_id text NOT NULL,
  skill_id uuid NOT NULL REFERENCES skill(id),
  confidence double precision NOT NULL,
  reasoning text NOT NULL,
  source_event_id uuid NOT NULL REFERENCES event(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX job_skill_company_external_idx ON job_skill (company_id, external_id);

-- job_action: Phase 4, the one real new persisted user-state table
CREATE TABLE job_action (
  id uuid PRIMARY KEY,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES company(id),
  external_id text NOT NULL,
  status text NOT NULL, -- 'saved' | 'applied' | 'dismissed'
  applied_at timestamptz,
  follow_up_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, company_id, external_id)
);
```

`JobFields` (event metadata — JSON, not a table) gains `description`, `employmentType`, `workplaceType`, all nullable and populated only where a source actually provides them. This is non-breaking: existing events keep whatever shape they were published with, and every read of `JobFields` is already defensive (zod `.passthrough()`/`safeParse`, the same pattern `skillKeywordClassifier` and the hiring detectors already use).

**Deferred, not Day 1:** a `job_match` table mirroring `match` exactly (User × Job → score/reasoning). Read-time computation of relevance is cheap enough at current volume (hundreds of jobs) to skip persisting it until either performance or "attach save-state to a stable row" needs force the issue — avoiding premature optimization.

---

## 4. Source/discovery strategy

Keep the existing **Directory** sources (Greenhouse/Lever/Ashby via curated `company_source_identity`) exactly as-is — they're correct for companies you already know about.

Add an **Aggregator** source shape for boards that return many companies' jobs in one call, each self-describing its company:

```ts
interface AggregatorJobSource<TRecord> {
  slug: string;
  sourceType: string;
  fetchRecords: () => Promise<TRecord[]>;      // no pre-known sourceIdentifier
  externalIdOf: (record: TRecord) => string;
  companyNameOf: (record: TRecord) => string;  // the new part
  createNormalizer: (companyId: string) => Normalizer;
}
```

Company resolution for an Aggregator record: normalize the source's company name (lowercase, strip `Inc.`/`Ltd.`/whitespace) and look for an **exact** match against existing `company.name`. A match resolves to that company (curated or discovered, unchanged). No match creates a new `discoveryStatus: 'discovered'` company. Deliberately **no fuzzy/Levenshtein matching in v1** — a false-positive merge (attributing a different company's jobs to an existing curated company) is worse than an occasional harmless duplicate "discovered" row. This mirrors the caution already documented in `company_source_identity`'s own doc comment about deferring "Merged" resolution.

Candidate sources to investigate before building (per your instruction — investigate, don't build all of them):
- **Web3.career** — has a documented public API, Web3-native, worth prioritizing.
- **RemoteOK** — documented public JSON API, has a crypto/web3 tag.
- **CryptocurrencyJobs.co** — worth checking for a public feed.
- **LinkedIn, Indeed, WellFound/AngelList** — explicitly **excluded**: ToS-prohibited scraping or enterprise-only APIs. Not pursued.

Recommendation: implement one Aggregator source (Web3.career, pending a real check of its terms and response shape) in Phase 3 as the proof, not all of them at once.

---

## 5. Relevance-scoring design

A plain, versioned, testable module — mirrors `SKILL_KEYWORDS`'s existing precedent in `skill-classifier.ts` exactly, not a new paradigm:

```ts
const POSITIVE_SIGNALS: Readonly<Record<string, number>> = {
  solidity: 25, "smart contract": 20, "smart contract security": 25,
  foundry: 15, hardhat: 10, evm: 15, defi: 10,
  "security research": 15, auditing: 15, "vulnerability research": 15,
  rust: 10, "protocol engineering": 15, web3: 5, ethereum: 10,
  // ...configurable, tested, extendable
};

const NEGATIVE_SIGNALS: Readonly<Record<string, number>> = {
  aml: -30, compliance: -25, accounting: -30, legal: -30,
  marketing: -30, sales: -30, "business development": -25,
  recruiter: -30, "customer support": -30, hr: -30,
};
```

Scored over `title + departmentNames + description` (falls back gracefully to title-only where `description` isn't captured yet — never treats "absent" as "neutral" silently; the DTO carries a `descriptionAvailable: boolean` so the UI can say so). Output is a structured breakdown, not just a number:

```ts
interface RelevanceResult {
  score: number; // 0-100, clamped
  breakdown: { label: string; weight: number }[]; // ["Solidity", +25], ["seniority mismatch", -3], ...
}
```

— the same shape the request's own example (`+25 Solidity / +20 smart contract security / -3 seniority mismatch`) describes, and directly renderable by the UI without further interpretation. Weights live in one exported const map, covered by deterministic unit tests (matched/unmatched/mixed/empty-description cases) — same "v1, documented as v1, not calibrated" framing `packages/scoring` already uses for its own thresholds.

Personalization (the final "match %" against a specific user's `target_role_slugs`/`user_skill`) is a second, thin layer on top: base relevance score, adjusted by profile skill/role overlap — reusing `computeMatch`'s existing scoring shape rather than inventing a second formula.

---

## 6. API changes

- `GET /api/jobs` — extend `jobFeedQuerySchema` (`packages/application/src/job-query-service.ts`) with `minMatch`, `skillIds[]`, `remote`, `freshness`, `seniority`, `sort: "relevance"` (new default). Extend `JobFeedItemDTO` with the new fields from §2/§3. Existing query params (`search`, `sort: "postedAt"|"title"`, pagination) stay valid — additive, not breaking.
- `GET /api/jobs/[id]` — new, for the job detail page (§7).
- `POST /api/jobs/[id]/actions` — new (Phase 4): `{ status: "saved" | "applied" | "dismissed", notes?, followUpAt? }`, writes `job_action`.
- `PATCH /api/profile` — extend the existing profile route with `targetRoleSlugs`, `remotePreference`, `locationConstraint`, `seniorityPreference`.
- `GET /api/opportunities` — add a `current: boolean` flag (default `false`, preserving today's behavior for any existing caller) that switches to `listCurrentCompanySignals`.

---

## 7. UI changes

- **`/jobs` becomes the default landing experience** (Mode A) — the summary strip from your Section 17 example, a match-score badge on `JobCard`, filters for match/skill/remote/freshness/seniority, default sort switched from `postedAt` to the composite relevance formula (§ below).
- **New `/jobs/[id]` detail page** — today's cards link straight to the external `absoluteUrl`; this adds an internal stop with the "Attack This Opportunity" section: Apply / Company / Careers links, the relevance breakdown, "Why now" pulled from that company's *current* Opportunity if one exists, and a **Generate Outreach** button that re-points the existing `packages/ai` outreach-draft infrastructure at a job instead of only a Recommendation.
- **`/opportunities` reframed as "Company Signals"** (Mode B) — switches to `listCurrentCompanySignals`, nav label updated. Still fully present, just explicitly secondary — nav order (Jobs, then Opportunities) already reflects this from Milestone 12.
- **Profile page** gains target-role/remote/location/seniority fields.

---

## 8. Migration strategy

Every schema change above is additive: new nullable/defaulted columns, new tables, no column removed or retyped. Zero downtime, zero data loss, fully reversible (every `ALTER TABLE ADD COLUMN` / `CREATE TABLE` has a trivial inverse).

- `company.discovery_status` backfills all 37 existing rows to `'curated'` in the same migration that adds the column.
- `job_skill`/`job_action` need no backfill — they populate forward-only as their pipelines run, exactly like `opportunity_skill`/`match` did when they were introduced.
- No existing Event is ever rewritten. `JobFields`' new optional metadata keys simply won't be present on already-ingested events — already-safe, since every consumer reads `JobFields` defensively.

---

## 9. Implementation phases

Your proposed sequencing is sound; annotated here against the real modules each step touches, since that's what turns it into an executable plan rather than a restatement.

**Phase 1 — Job correctness** (no new domain concepts, fixes what's wrong today)
1. Add `description`/`employmentType`/`workplaceType` to `JobFields` + all three ATS normalizers, where the source provides them.
2. Freshness/status: `job-query-service.ts` gains `freshness` bucketing (`raw_record.fetchedAt` as the reliable floor, source `updated_at` only trusted within a sane bound) and an explicit `status`. Default `/api/jobs` view = `open` + `fresh`/`recent`, with an explicit toggle for older listings — not a silent delete.
3. Dedup across sources stays as today's `(collectorId, externalId)` scoping (ADR 0002) — already correct; no change needed unless the same job appears under two different ATS platforms for the same company, which isn't observed in current data.
4. Confirm every job carries `absoluteUrl` + the company's `careersPageUrl` (already on `company`) in the DTO.

**Phase 2 — Job relevance**
1. `user_profile` schema changes (§3).
2. `job_skill` + re-pointed `skillKeywordClassifier` (§2).
3. Relevance scorer module (§5) + unit tests.
4. `/api/jobs` gains `minMatch`/`sort=relevance`; default sort changes.
5. Explainable match reasons rendered on `JobCard`/`/jobs/[id]`.

**Phase 3 — Broad discovery**
1. `company.discovery_status` migration.
2. `AggregatorJobSource` interface (§4).
3. Investigate Web3.career (and RemoteOK) — confirm terms + response shape before building.
4. Implement one Aggregator source end-to-end as proof.
5. Confirm in production: at least one `discoveryStatus: 'discovered'` company with real jobs, not in the 37 curated JSON files.

**Phase 4 — Action layer**
1. `job_action` table + `/api/jobs/[id]/actions`.
2. `/jobs/[id]` detail page with Apply/Company/Careers links.
3. Contact-path surfacing (company's own public links only — §2's explicit scope limit).
4. Generate-outreach button, re-pointing existing `packages/ai` infrastructure at a job.
5. Save/Applied/Follow-up UI state.

**Phase 5 — Intelligence** (only after the above works, per your instruction)
1. `listCurrentCompanySignals` de-duplication (§2) — this is cheap and could move earlier if you want the Opportunities page cleaned up sooner; sequenced last only because it's pure UX polish on an already-correct system, not a blocker for job-hunting utility.
2. `associatedOpportunity` join on Job Target.
3. "Why now" company-signal context on the job detail page.

---

## 10. Tests and production verification criteria

**Unit tests (new):**
- Relevance scorer: matched/unmatched/mixed positive+negative/empty-description cases; weight-sum clamping.
- Freshness bucketing: boundary days (7/30/60), missing/implausible source timestamp → `unknown`, not a fabricated bucket.
- `listCurrentCompanySignals`: only the latest `detectionWindow` per `(companyId, opportunityType)` returned; history still reachable via the existing feed.
- `AggregatorJobSource` company resolution: exact-normalized-name match reuses the existing company untouched; no match creates a `discovered` company; never silently mutates an existing `curated` company's enrichment fields.

**Integration tests (new):** mirror `run-ingestion-pipeline.integration.test.ts`'s and `matching.integration.test.ts`'s existing conventions for the new job-skill classification step and (when introduced) `job_match`.

**Production verification (live, not just local — matching this project's own established discipline):**
- After Phase 1: no job older than the defined "stale" bound appears in the default `/api/jobs` view on the real deployment.
- After Phase 2: a real configured profile produces a ranked list where an on-profile title outranks an off-profile one, verified against live data.
- After Phase 3: at least one company with `discoveryStatus: 'discovered'` and real published jobs is visible on the live `/api/jobs`, and it is **not** one of the 37 curated JSON files.
- After Phase 4: Save/Applied state persists across a reload on the real deployed app, not just in a test DB.

---

## What this document deliberately does not do

Per your instruction, it does not redesign Events, Raw Records, Collectors' core orchestration, the Opportunity model, or the ADR 0002 ingestion-correctness work — all of it is reused as-is. It does not commit to building every candidate job source, automated contact scraping, or AI matching before deterministic matching exists. Those are explicitly named and explicitly deferred, not silently dropped.
