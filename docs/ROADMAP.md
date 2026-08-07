# Web3 Hunter — Implementation Roadmap

Status: Draft v0.1
Owner: Engineering
Depends on: [docs/PRODUCT.md](./PRODUCT.md), [docs/ARCHITECTURE.md](./ARCHITECTURE.md), [docs/DOMAIN_MODEL.md](./DOMAIN_MODEL.md), [docs/EVENT_MODEL.md](./EVENT_MODEL.md), [docs/DATABASE.md](./DATABASE.md)

This document sequences the work defined in the five documents above into shippable milestones. Each milestone produces something real — running, deployed, and usable — while strictly respecting the architecture already approved. No milestone introduces a shortcut that a later milestone has to unwind.

---

## Roadmap Philosophy

Four sequencing decisions shape every milestone below, and are worth stating once instead of re-justifying ten times:

1. **Pure infrastructure ships before any architectural concept is implemented.** [Milestone 0](#milestone-0--repository-foundation) establishes the monorepo, tooling, and deployment plumbing with zero business logic and zero domain concepts — no Event, no Company, no Opportunity. This keeps the first real architectural decision (what an Event looks like in storage) from being tangled up with unrelated tooling decisions (how the monorepo builds).
2. **A thin, real, end-to-end slice comes before any subsystem is built out in depth.** [Milestone 2](#milestone-2--first-collector-the-walking-skeleton) deliberately ships one Collector producing real Canonical Events before any Collector-adjacent subsystem exists in full — because the biggest architectural risk in an event-driven system isn't any single subsystem, it's the seams between them. Proving Collector → Event → Persistence → Replay works for real, on real data, early, de-risks every subsequent milestone that builds on top of it.
3. **Deterministic logic ships before AI, and a usable product ships before personalization.** Per this brief's explicit instruction, the entire deterministic pipeline — Collectors, Scoring Engine, Decision Engine — is built and delivering real value ([Milestone 4](#milestone-4--public-opportunity-feed-first-usable-product) is a genuinely usable, public product) before the AI Layer is touched at all in [Milestone 7](#milestone-7--ai-enrichment-layer). This is not caution for its own sake: it means AI is optional to the product working at all, which is exactly the guarantee [ARCHITECTURE.md §9](./ARCHITECTURE.md#9-design-constraints) requires ("AI never becomes the source of truth").
4. **Horizontal scale-out (more Collectors, more sources) is deliberately last, not first.** It's tempting to build many Collectors early because they look like fast, parallelizable progress. They aren't prioritized that way here: per [EVENT_MODEL.md §Future Extensions](./EVENT_MODEL.md#future-extensions), adding a Collector is designed to be additive and cheap *once the pipeline it feeds is proven* — building ten Collectors against a Scoring Engine that doesn't exist yet just produces ten sources of unused data. [Milestone 9](#milestone-9--ecosystem-scale-out) is where that cheap, parallelizable expansion actually pays off.

## Milestone Overview

| # | Milestone | Goal | Complexity |
|---|---|---|---|
| 0 | [Repository Foundation](#milestone-0--repository-foundation) | The monorepo, tooling, and deploy plumbing exist — zero business logic | Medium |
| 1 | [Event & Data Foundation](#milestone-1--event--data-foundation) | The event store and event contracts exist and are enforced | Medium |
| 2 | [First Collector](#milestone-2--first-collector-the-walking-skeleton) | One real hiring-intent source flows through the full ingestion pipeline | Medium |
| 3 | [Scoring Engine v1](#milestone-3--scoring-engine-v1-signals-intelligence-opportunities) | Raw events become explainable, scored Opportunities | High |
| 4 | [Public Opportunity Feed](#milestone-4--public-opportunity-feed-first-usable-product) | The first real, usable product ships | Medium |
| 5 | [Accounts, Profiles & Matching](#milestone-5--user-accounts-profiles--matching) | The feed becomes personalized | Medium-High |
| 6 | [Decision Engine](#milestone-6--decision-engine-recommendations-digests-notifications) | The platform proactively surfaces what matters | Medium-High |
| 7 | [AI Enrichment Layer](#milestone-7--ai-enrichment-layer) | Explanations and outreach get AI-generated | High |
| 8 | [CRM Depth & Feedback Loop](#milestone-8--crm-depth-applications--feedback-loop) | Outcomes are tracked and quality compounds | Medium |
| 9 | [Ecosystem Scale-Out](#milestone-9--ecosystem-scale-out) | Many more sources, cheaply — GitHub enrichment included | Low–Medium (per source) |
| 10 | [Pipeline Run Observability](#milestone-10--pipeline-run-observability) | Close the operational feedback loop for the deterministic pipeline stages that had none | Low–Medium |
| 11 | [Collector Ecosystem & Ingestion Correctness](#milestone-11--collector-ecosystem--ingestion-correctness) | Company tracking becomes data-driven, not hardcoded; a Raw Record misattribution bug found mid-implementation is fixed | High |

Milestones 10 and 11 were not in this document's original plan — both were identified by direct architectural review of the system as actually built, per each entry's own Goal, rather than sequenced here in advance. See [docs/adr/](./adr/) for the architectural decisions made during Milestone 11's implementation.

---

## Milestone 0 — Repository Foundation

**Goal:** Establish the engineering foundation before any product functionality exists. Nothing in this milestone represents a business or domain concept — no Event, no Company, no Opportunity. It is exclusively the scaffolding every later milestone builds on.

**Features:**
- Turborepo + pnpm workspaces as the monorepo's build and dependency-management backbone.
- `apps/web` bootstrapped on Next.js 15 (App Router), TypeScript in strict mode across every package.
- Tailwind CSS and shadcn/ui, wired so shared UI primitives live in `packages/ui` rather than directly in `apps/web`, consistent with [ARCHITECTURE.md §6](./ARCHITECTURE.md#6-package-boundaries).
- Drizzle ORM configured against Supabase Postgres, plus the migration workflow (generate → apply) proven end-to-end — but with no domain schema. See the note below on how this milestone proves the workflow without introducing business logic.
- Better Auth installed and wired to the database (its own account/session tables only) — no sign-up/profile UI, no User Profile domain modeling. That is explicitly [Milestone 5](#milestone-5--user-accounts-profiles--matching)'s work.
- ESLint (flat config) with architectural boundary enforcement — [ARCHITECTURE.md §3](./ARCHITECTURE.md#3-monorepo-structure)'s dependency-direction rules encoded as lint rules, not just prose, from the very first commit.
- Prettier, Husky, and lint-staged so formatting and linting are enforced pre-commit, not just in CI.
- Docker (a production Dockerfile for `apps/web`, plus a local Postgres via docker-compose for development independent of a live Supabase project).
- GitHub Actions CI (install, lint, typecheck, build, test) gating every change.
- Environment validation (a single, typed, fail-fast schema — no code path silently runs with a missing or malformed environment variable).
- A real health check page and API route that verify full-stack connectivity (Next.js → Drizzle → Postgres), backed by one minimal, genuinely infrastructural table — not a placeholder feature, a real one, just not a domain one.
- The complete `packages/*` skeleton from [ARCHITECTURE.md §3](./ARCHITECTURE.md#3-monorepo-structure) (`db`, `collectors`, `scoring`, `decision`, `ai`, `events`, `notifications`, `shared`, `ui`), each a real, empty, independently buildable TypeScript package with its dependency direction enforced.

**Dependencies:** None — this is the first milestone.

**Estimated complexity:** Medium. Low conceptual risk, wide surface area — the risk here is inconsistency across packages, not difficulty in any one of them.

**Deliverables:** A running monorepo; CI green on a trivial PR; `pnpm dev` serves a working health check page; `pnpm db:generate` / `pnpm db:migrate` round-trip against a real Postgres database; an attempted cross-package import that violates [ARCHITECTURE.md §3](./ARCHITECTURE.md#3-monorepo-structure) fails at lint time.

**Definition of Done:** A developer can clone the repo, run one install command, and get a working local environment. `pnpm build`, `pnpm typecheck`, and `pnpm lint` all pass. The health check page reports a real, live database connection, not a hardcoded "ok". Husky blocks a commit that fails lint-staged. No file in this milestone references a domain concept from [DOMAIN_MODEL.md](./DOMAIN_MODEL.md).

---

## Milestone 1 — Event & Data Foundation

**Goal:** With infrastructure in place from Milestone 0, implement the first real architectural concept: the canonical event log itself. Every later milestone depends on this existing and being trustworthy.

**Features:**
- `packages/events`: canonical event contracts and a first, pragmatic event-bus implementation, resolving [ARCHITECTURE.md Open Question #1](./ARCHITECTURE.md#10-open-questions) with the simplest viable choice rather than leaving it open indefinitely.
- `packages/db`: the Event store schema per [DATABASE.md §5](./DATABASE.md#5-event-storage) (Event ID, Event Type, Version, Source, Occurred At / Recorded At, Related Entity, Provenance, Confidence, Metadata) and the Collector aggregate schema per [DATABASE.md §3](./DATABASE.md#3-aggregate-boundaries) — append-only enforcement at the database-permission level, not just convention.
- Replay support: the event store can be read back sequentially and filtered by Company, Event Type, or time range, per [EVENT_MODEL.md §Event Rules](./EVENT_MODEL.md#event-rules).

**Dependencies:** Milestone 0.

**Estimated complexity:** Medium.

**Deliverables:** A real event can be inserted through `packages/events`' publish path and read back through `packages/db`, fully typed, with every field from [EVENT_MODEL.md §Event Structure](./EVENT_MODEL.md#event-structure) present and queryable.

**Definition of Done:** The event store rejects updates and deletes at the database-permission level. An inserted event round-trips with zero data loss. Replaying a sequence of test events reconstructs the same state deterministically.

---

## Milestone 2 — First Collector: the Walking Skeleton

**Goal:** Prove the entire ingestion pipeline end-to-end with one real source — chosen specifically to validate the product's core hypothesis, not merely for engineering convenience — before building any scoring or product surface on top of it.

**Features:**
- One Collector against a source that directly represents hiring intent: an ATS provider's public job-board API (Greenhouse, Ashby, or Lever — final selection made at implementation time based on which has the strongest coverage among Web3 companies). This is a deliberate change from a purely technical-signal source: the product's hypothesis is that hiring intent can be detected *before* it's widely advertised, so the very first Collector has to touch hiring intent directly, not a proxy for it. GitHub remains an important signal, but is repositioned to **enrich** Opportunities once they exist rather than to found the first usable product — see [Milestone 9](#milestone-9--ecosystem-scale-out).
- The full Raw Record → Normalization → Deduplication → Canonical Event pipeline from [EVENT_MODEL.md §Event Lifecycle](./EVENT_MODEL.md#event-lifecycle), implemented for real, not stubbed.
- Scheduler for polling cadence, backoff, and basic rate-limit handling.
- Minimal Company identity creation/resolution — enough to attach events to a stable Company record, not the full entity-resolution design deferred in [DATABASE.md §9](./DATABASE.md#9-open-questions).
- Collector health/observability: staleness and failure rate visible per [ARCHITECTURE.md §7](./ARCHITECTURE.md#7-engineering-principles).

**Dependencies:** Milestone 1.

**Estimated complexity:** Medium.

**Deliverables:** For a seeded list of tracked companies, `JobPosted` / `JobUpdated` / `JobClosed`-type Events flow into the canonical event log continuously, each fully provenanced per [EVENT_MODEL.md §Event Structure](./EVENT_MODEL.md#event-structure), and are visible via a basic internal query — no user-facing UI required yet.

**Definition of Done:** A new job posting for a tracked company appears in the event log within one polling cycle. Re-polling the same posting does not create duplicate events. Replaying the event log from empty reconstructs the same Company records. A second Collector could be added by a new engineer without needing to touch this one's code. The source's terms of service have been reviewed and permit this use — see [Legal / ToS Review](#legal--tos-review--a-cross-cutting-gate-not-a-milestone) below.

---

## Milestone 3 — Scoring Engine v1: Signals, Intelligence, Opportunities

**Goal:** Turn raw activity into the platform's actual product value — a real, explainable Opportunity — using deterministic rules only. This is the highest-risk, most novel piece of business logic in the system, which is exactly why it's proven early, before anything else is built on top of it.

**Features:**
- `packages/scoring` implementing Signal generation (rule-based interpretation of Events — e.g., a newly opened role at a previously quiet company, or several roles opening in a short window), per [DOMAIN_MODEL.md §Signal](./DOMAIN_MODEL.md#signal). Once enrichment Collectors such as GitHub land in [Milestone 9](#milestone-9--ecosystem-scale-out), the same Signal-generation logic incorporates their Events too — this milestone's rules only need to be extended, not redesigned.
- Intelligence aggregation per Company, with the decay behavior specified in [DOMAIN_MODEL.md §Intelligence](./DOMAIN_MODEL.md#intelligence).
- Opportunity detection once a Company's Intelligence crosses a confidence threshold, with a stored, queryable evidence chain back to the originating Events — enforcing [Domain Rule #1](./DOMAIN_MODEL.md#domain-rules) mechanically, not just by convention.

**Dependencies:** Milestone 2 (needs a real, continuous stream of Events to correlate).

**Estimated complexity:** High. Thresholds, decay rates, and correlation rules are genuinely hard to get right and will need iteration — this milestone should be scoped to a first defensible version, not a finished scoring model.

**Deliverables:** Opportunities are created and persisted for tracked companies whenever the (intentionally simple, initial) hiring-likelihood rules are satisfied, each with a human-readable evidence trail.

**Definition of Done:** Given sufficient GitHub activity for a tracked Company, an Opportunity is created with a score and a reconstructable explanation citing specific Events. Scores update as new Events arrive. No Opportunity exists in the system without a full provenance chain — this is verified by an automated check, not just tested by hand.

---

## Milestone 4 — Public Opportunity Feed (First Usable Product)

**Goal:** Ship the first version of the actual user-facing product. This is the milestone that turns "we have an architecture" into "we have a product someone can use" — and it does so before accounts, personalization, or AI exist at all.

**Features:**
- `apps/web` frontend rendering the Opportunity Feed and Company Intelligence read models from [DATABASE.md §6](./DATABASE.md#6-read-models).
- Public, unauthenticated, read-only browsing.
- The explainability UI: every Opportunity visibly shows the evidence behind it, not just a score.
- Basic filter/search (by chain, language, company stage).

**Dependencies:** Milestone 3.

**Estimated complexity:** Medium.

**Deliverables:** A deployed, publicly browsable Opportunity Feed showing real, explainable Opportunities sourced from live hiring-intent data.

**Definition of Done:** A visitor with no account can browse live Opportunities, see the specific evidence behind each one, and filter by basic criteria. This version is genuinely useful on its own — it is not a demo or an internal preview, and could reasonably be shared publicly as-is.

---

## Milestone 5 — User Accounts, Profiles & Matching

**Goal:** Take the first step from "a feed anyone can browse" to "a feed tailored to you."

**Features:**
- Full authentication (superseding the Milestone 1 scaffold).
- User Profile: Skills, chain/language experience, company-stage preferences, deal-breakers, per [DOMAIN_MODEL.md §User Profile](./DOMAIN_MODEL.md#user-profile).
- Skill and Tech Stack taxonomies, per [DOMAIN_MODEL.md §Skill](./DOMAIN_MODEL.md#skill) and [§Tech Stack](./DOMAIN_MODEL.md#tech-stack).
- Match computation (User Profile × Opportunity) and personalized feed ranking, per [DOMAIN_MODEL.md §Match](./DOMAIN_MODEL.md#match).

**Dependencies:** Milestone 4 (a working Opportunity Feed must exist before it's worth personalizing).

**Estimated complexity:** Medium-High.

**Deliverables:** Sign-up/login; an editable Profile; the feed re-ranked and filterable by computed Match relevance, with the reasoning behind each Match visible (per the [Match ≠ Score](./DOMAIN_MODEL.md#ubiquitous-language) distinction — never a bare number).

**Definition of Done:** A registered User with a complete Profile sees Opportunities ranked by relevance to their stated Skills and preferences, with visible reasoning for each Match. Deal-breaker preferences are respected as hard filters, never soft-scored around.

---

## Milestone 6 — Decision Engine: Recommendations, Digests, Notifications

**Goal:** Move from "the User has to come and browse" to "the platform proactively surfaces what matters" — using deterministic rules only, per the [Architectural Philosophy](./ARCHITECTURE.md#1-architectural-philosophy) constraint that AI still has not entered the pipeline.

**Features:**
- `packages/decision` implementing recommend / notify / digest-inclusion / follow-up / outreach-priority rules, per [ARCHITECTURE.md §2](./ARCHITECTURE.md#2-high-level-system-overview).
- Recommendation entity with templated (non-AI) explanations.
- Daily Digest composition and delivery (email, at minimum), respecting per-User cadence preferences.
- CRM Follow-up scheduling on deterministic triggers.

**Dependencies:** Milestone 5 (needs Matches to decide on) and Milestone 3 (needs Opportunity scores).

**Estimated complexity:** Medium-High.

**Deliverables:** Users with qualifying Matches receive a Digest at their configured cadence containing only Decision-Engine-selected entries, each with a plain, templated explanation. Basic CRM view shows saved items and scheduled Follow-ups.

**Definition of Done:** A Digest never includes an entry the Decision Engine didn't explicitly select. An empty Digest — nothing qualified — is an observed, accepted outcome, per the [Product Principle](./PRODUCT.md#9-product-principles) of prioritizing quality over quantity; the system never pads a Digest to look active.

---

## Milestone 7 — AI Enrichment Layer

**Goal:** Layer AI on top of an already-proven, already-valuable deterministic pipeline, to elevate explanation quality and add outreach drafting. This is deliberately the first milestone where AI appears anywhere in the system.

**Features:**
- `packages/ai` implementing enrichment: AI-generated explanations superseding the templated ones from Milestone 6, grounded in cited Events per [ARCHITECTURE.md §9](./ARCHITECTURE.md#9-design-constraints).
- Contact identification for a given Opportunity/Company.
- Personalized outreach draft generation.
- `AIRecommendationGenerated` event wiring, consumed only from already-published Decision Engine events — never triggered independently.

**Dependencies:** Milestone 6 (the Decision Engine must be the sole source of "what to enrich").

**Estimated complexity:** High — new external dependency (a model provider), plus cost, latency, and prompt-grounding concerns that don't exist anywhere earlier in the roadmap.

**Deliverables:** Recommendations and Digest entries carry AI-written explanations; an outreach draft plus a suggested Contact is available per Recommendation.

**Definition of Done:** Every AI-generated explanation or draft is traceable back to the Decision and underlying Events it was generated from — no ungrounded content ships. If the AI provider is unavailable, delivery degrades gracefully to the Milestone 6 templated explanation rather than blocking the Recommendation or Digest entirely — proving in production, not just on paper, that "AI never becomes the source of truth."

---

## Milestone 8 — CRM Depth, Applications & Feedback Loop

**Goal:** Close the loop. Track what actually happens after a Recommendation, and let that feedback start improving future Matches and Decisions.

**Features:**
- Application tracking with self-reported status updates, per [DOMAIN_MODEL.md §Application](./DOMAIN_MODEL.md#application).
- Full CRM: notes, saved companies, outreach status.
- `MatchFeedbackRecorded` ingestion feeding back into scoring/matching calibration, per the [Calibration step](./PRODUCT.md#6-user-journey) in the product journey.
- Instrumentation for the [North Star and supporting success metrics](./PRODUCT.md#10-success-metrics).

**Dependencies:** Milestone 7 (the full pipeline needs to exist before there's a meaningful loop to close).

**Estimated complexity:** Medium.

**Deliverables:** Users can log Applications and outcomes; explicit feedback ("relevant" / "not relevant") on Matches is captured and observably used to adjust future scoring or ranking; a metrics view tracks weekly high-conviction matches acted on.

**Definition of Done:** A User can mark a Recommendation as applied, track its status, and see that reflected in their CRM. Recorded feedback measurably changes future Match behavior for that User — even a simple weighting adjustment satisfies this, a fully learned model does not need to exist yet.

---

## Milestone 9 — Ecosystem Scale-Out

**Goal:** Broaden signal coverage now that the pipeline, scoring, decision, and AI layers are all proven. This is intentionally the milestone where most of the remaining Collectors from [PRODUCT.md §7.1](./PRODUCT.md#71-signal-aggregation-engine) get built — additional ATS providers, official career pages, funding trackers, grant programs, hackathon results, engineering blogs, and RSS/news sources.

**Features:**
- **GitHub is prioritized first among these additions**, ahead of the others in this milestone: per [Milestone 2](#milestone-2--first-collector-the-walking-skeleton)'s decision to reposition it as an enrichment source rather than the founding one, GitHub activity directly strengthens the confidence and evidence behind Opportunities already being detected from hiring-intent sources — it's the highest-leverage addition specifically because the Scoring Engine and its Companies already exist to enrich.
- Additional Collectors added one at a time thereafter, each following the exact pattern established in Milestone 2.
- Every additional Collector extends `company_source_identity` (per [ARCHITECTURE.md §10, item 4](./ARCHITECTURE.md#10-open-questions), resolved in Milestone 8) with its own explicit source-identifier-to-Company mappings — no new entity-resolution design needed, just configuration.
- Expanded Signal vocabulary as new Event categories (Repository, Funding, Grant, Release, Founder — already named in [EVENT_MODEL.md §Event Categories](./EVENT_MODEL.md#event-categories)) start actually flowing.

**Dependencies:** Milestones 1–8 (the pattern is established once, then replicated).

**Estimated complexity:** Low–Medium per additional source; the milestone as a whole is naturally parallelizable across engineers once the pattern is proven, precisely because Collectors were designed to be additive.

**Deliverables:** N additional live Collectors, each shipped independently.

**Definition of Done:** Each new Collector ships without requiring any change to Scoring, Decision, AI, or Frontend code — the empirical proof that the "additive extension" claim in [ARCHITECTURE.md §8](./ARCHITECTURE.md#8-scalability) and [EVENT_MODEL.md §Future Extensions](./EVENT_MODEL.md#future-extensions) actually holds, not just that it was designed to.

---

## Milestone 10 — Pipeline Run Observability

**Goal:** Close the one operational feedback loop the system didn't have: Scoring, Classification, Technology Detection, Matching, and Decision all ran with zero visibility into whether or how they executed, unlike Collectors, which have had Collector Health since Milestone 8. Identified by direct architectural review of the system as it stood after Milestone 9, not sequenced in this document's original plan — the review's own reasoning, and the candidates considered and rejected, are not reproduced here.

**Features:**
- `pipeline_run` (`packages/db`): an append-only log, one row per pipeline invocation — not a mutable per-entity snapshot like Collector Health, since Scoring/Classification/Technology/Matching/Decision each run repeatedly over the same Company/Opportunity/User, unlike a Collector. Records pipeline name, a polymorphic scope (type + id, no foreign key), status, timing, and a `jsonb` metrics payload mirroring each pipeline's own result shape.
- `recordPipelineRun` (`apps/web/lib/observability`): a single, thin, centralized wrapper instrumenting every recurring pipeline script — `score:companies` (new; the Scoring Engine had no trigger script at all before this, a gap flagged in Milestones 8 and 9), `classify:opportunities`, `detect:technology`, `match:users`, `decide:recommendations` — without altering any deterministic pipeline logic itself. Proven non-invasive by a dedicated integration test comparing wrapped and unwrapped output.
- `GET /api/pipeline-runs` (`packages/application` + `apps/web`): a read-only, unauthenticated query API mirroring Collector Health's existing shape.
- Deliberately not event-sourced, for the same reason Collector Health isn't: this is operational telemetry about *how the system ran*, not a reproducible business fact.

**Dependencies:** Milestone 8 (extends the Collector Health pattern established there).

**Estimated complexity:** Low–Medium — extends an already-proven pattern; no new architectural concepts.

**Deliverables:** Every recurring deterministic pipeline invocation is durably recorded and queryable via `GET /api/pipeline-runs`, including failures and their error messages.

**Definition of Done:** A failed pipeline run is queryable with a specific error message, not just a generic failure flag. Wrapping a pipeline invocation with `recordPipelineRun` produces byte-identical business output to calling it directly — verified by an automated test, not just inspection.

---

## Milestone 11 — Collector Ecosystem & Ingestion Correctness

**Goal:** Move company tracking from a hardcoded array — the ceiling on this system ever supporting more than a handful of companies — to a curated, data-driven directory that scales by adding data, not code, while making Companies and Opportunities richer and more directly actionable. Identified the same way as Milestone 10, by direct architectural review, not sequenced in advance; several rounds of architectural review (an approach comparison across three designs, an adversarial review, a final production-readiness approval) preceded implementation.

**Features:**
- `company` gains curated profile metadata — website, careers page, documentation, blog, social links, logo, description, headquarters, funding stage, tags, and a closed `category` enum — all nullable, all operator-curated rather than event-sourced (the same category of data as the Skill taxonomy, not a new one).
- A curated company directory: one git-committed JSON file per company under `apps/web/data/companies/`, loaded by a new `seed:companies` script into `company` and `company_source_identity` via `packages/db`'s `upsertCompanyDirectory` (mirroring `seedSkillTaxonomy`'s existing pattern). This is the mechanism: adding a company on an already-supported source becomes a data change, never a code change.
- Every Collector (Greenhouse, Lever, Ashby, GitHub) cut over to resolve its tracked companies from `company_source_identity` through this directory, replacing the static `tracked-companies.ts` / `tracked-github-orgs.ts` arrays (deleted).
- Lever and Ashby — Collector logic that had existed since Milestone 9 but was never wired to a tracked company or given a CLI/cron entry point — wired for the first time.
- Bounded, fetch-only concurrency in the Collector orchestrator, documented in [ADR 0001](./adr/0001-fetch-only-collector-concurrency.md).
- **An ingestion correctness fix, discovered during implementation, not pre-planned.** Investigating collector concurrency surfaced a real, already-live bug: `packages/ingestion`'s `runIngestionPipeline` and `reconcileMissingRecords` scoped their queries by Collector alone — for any Collector tracking more than one company, already true of the live Greenhouse Collector, this let one company's Raw Records be normalized under another company's identity, or one company's still-open roles be reconciled as closed under another's. Fixed by adding `source_identifier` to `raw_record` and scoping every affected query by it, documented in [ADR 0002](./adr/0002-source-scoped-ingestion.md). This does not repair already-corrupted historical data — see that ADR's documented assumptions.

**Dependencies:** Milestone 8 (`company_source_identity`, the resolution mechanism the directory writes into) and Milestone 9 (the Collector pattern this generalizes).

**Estimated complexity:** High — not from any single piece, but from the ingestion correctness fix surfacing mid-implementation and requiring its own architectural review (three approaches compared, an adversarial pass, a final approval) before any of it was implemented.

**Deliverables:** A curated directory of real, verified companies spanning all four supported sources; `seed:companies` as the sole mechanism for growing it; every Collector reading from it instead of a hardcoded array; the Raw Record misattribution bug fixed and empirically verified against the real, previously-failing scenario.

**Definition of Done:** Adding a company on an already-supported source requires a new directory entry and a re-seed, never a code change. Two companies sharing a Collector no longer misattribute each other's Raw Records or reconciliation state — verified by a regression test that reproduces the original failure against the real, unmodified pre-fix code and confirms it no longer occurs post-fix.

---

## Legal / ToS Review — a Cross-Cutting Gate, Not a Milestone

[ARCHITECTURE.md Open Question #7](./ARCHITECTURE.md#10-open-questions) and [DOMAIN_MODEL.md](./DOMAIN_MODEL.md) both flag that several intended sources may carry scraping or terms-of-service constraints. This isn't scheduled as its own milestone because it isn't sequential work — it's a per-Collector gate: **before any Collector is built, its source's legal/ToS status must be reviewed.** This applies starting with [Milestone 2](#milestone-2--first-collector-the-walking-skeleton) itself — an ATS provider's public job-board API is generally lower-risk than scraping an arbitrary career page, but "generally lower-risk" is not the same as "reviewed," and Milestone 2 is the first milestone that touches an external data source at all. It continues to apply to every source added in Milestone 9. Treat it as a blocking prerequisite for each new source, not a retrospective audit.

---

This roadmap should be revisited after every milestone ships — not rewritten from scratch, but checked against what was actually learned (especially in Milestone 3, where the scoring rules are explicitly expected to need iteration). Milestone 11 is the most recently completed milestone. This document was not maintained as a live status tracker between Milestone 9 and the point Milestones 10–11 were added — see [README.md](../README.md#status) for current status and [docs/adr/](./adr/) for architectural decisions made outside this document's original sequencing.
