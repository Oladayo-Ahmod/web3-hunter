# Web3 Hunter — System Architecture

Status: Draft v0.2
Owner: Engineering
Depends on: [docs/PRODUCT.md](./PRODUCT.md)

This document is the single source of truth for architectural decisions in this repository. It defines *how the system is shaped* and *why* — not how any individual feature is implemented. Any implementation that violates the principles here should be treated as a bug in the implementation, not a gap in the document.

---

## 1. Architectural Philosophy

Web3 Hunter is an **event-driven intelligence platform**, not a traditional CRUD application. This is a deliberate choice, not a default.

A CRUD application assumes a small number of well-known write paths: a user submits a form, a record is created or updated, a page reads it back. That model fits an ATS or a job board, where the primary object (a listing, an application) has one clear owner and a simple lifecycle.

Web3 Hunter's core problem is structurally different, per [docs/PRODUCT.md](./PRODUCT.md):

- **Facts arrive continuously, asynchronously, and from heterogeneous sources** — a career page changes, a funding round is announced, a repository is created, a grant is awarded. None of these originate from a user action inside our system. There is no "form submission" to hang a CRUD write on.
- **A single fact fans out to many independent reactions.** A funding announcement should feed scoring, potentially trigger a recommendation and a notification, and update search indices — without the funding collector needing to know any of that. In a CRUD model, this becomes a growing pile of side effects bolted onto a single write handler.
- **Explainability is a product requirement, not a nice-to-have.** [Product Principle: "Explain every recommendation"](./PRODUCT.md#9-product-principles) means every score, every decision, and every AI output must be traceable back to the specific facts that produced it. A mutable row that gets overwritten on each update destroys that trail. An immutable event log preserves it by construction.
- **Consumers will be added over time that producers can't anticipate.** Search, notifications, and future features (see [Future Vision](./PRODUCT.md#11-future-vision)) will all need to react to the same underlying facts. Coupling collectors directly to every downstream concern creates a combinatorial integration problem as the system grows.
- **Replay and backfill are first-class needs, not edge cases.** When we improve scoring or decision rules, or ship a new consumer, we need to re-process history against it. That is naturally supported by an event log and unnaturally bolted onto a CRUD system.

The organizing idea: **the system does not model "records that get updated," it models "facts that happened."** A company doesn't have its `fundingStatus` field mutated — a `CompanyFunded` event is recorded. Everything else is a *derived, rebuildable projection* of the event history, not the source of truth itself.

### 1.1 Companies produce events. Events produce Opportunities. Opportunities are what users act on.

This is the central modeling decision in the system, and it should be read as a strict hierarchy:

1. **Companies and the ecosystem produce raw events.** A `CompanyFunded`, `JobPosted`, `GrantAwarded`, or `RepositoryCreated` event is a fact about the world. On its own, it is not something a user does anything with — it is raw material.
2. **Events, once correlated, produce Opportunities.** An Opportunity is not a raw event and not a company — it is a derived, scored, explainable entity that the Scoring Engine constructs by correlating one or more events about a company (and the ecosystem around it) into "here is something specific worth a user's attention, and here is why."
3. **Opportunities are what users act upon.** Every user-facing concept downstream — a recommendation, a notification, a digest entry, a CRM entry, an outreach draft — is anchored to an Opportunity, never directly to a raw event or a bare company record. A company is context *for* an Opportunity, not itself the unit of action.

This distinction is what keeps the rest of the architecture coherent: collectors and companies live at the *signal* layer, Opportunities live at the *product* layer, and every subsystem from the Decision Engine onward is designed to consume Opportunities, not to reach back into raw company facts. Where this document refers to "scoring a company" or "notifying about a company" loosely, the precise meaning is always "scoring/notifying about an Opportunity derived from that company's events."

This is what makes the platform an intelligence system: intelligence is produced by observing a stream of facts over time, correlating them into a distinct, actionable Opportunity, and explaining that correlation — which is precisely what an event-driven architecture is built to do.

---

## 2. High-Level System Overview

```text
Sources (external)
      │
      ▼
 Collectors ──▶ Ingestion Pipeline ──▶ Scheduler ──▶ Event Bus
             (Raw Record storage,
            normalize, dedupe, publish)
                                  │
                                  ▼
                           Scoring Engine
                    (correlates events into Opportunities,
                        computes explainable scores)
                                  │
                                  ▼
                           Decision Engine
                (deterministic: recommend, notify, digest,
                    follow-up, prioritize outreach)
                                  │
              ┌───────────────────┼───────────────────┐
              ▼                   ▼                    ▼
          AI Layer             Search             Notifications
     (enrichment, expla-   (Opportunity /       (delivers what the
      nation, outreach      company read          Decision Engine
          copy)                models)              decided)
              │                   │                    │
              └───────────────────┼────────────────────┘
                                  ▼
                             Persistence
                    (Opportunity is the primary,
                       durable read model)
                                  │
                    ┌─────────────┴─────────────┐
                    ▼                            ▼
                 Backend  ◀──────────────────▶  CRM
                    │
                    ▼
              Frontend (Dashboard)
```

### Frontend

Presentation only. Renders Opportunities, company context, digests, and CRM state. Never contains scoring, decision, or enrichment logic. Talks to the Backend, never directly to collectors, the event bus, the Scoring/Decision engines, or the AI layer.

### Backend

The application-facing API surface. Owns request/response contracts with the frontend, authorization, and orchestration of user-initiated actions (e.g., "generate outreach for this Opportunity now"). Translates user actions into commands and, where appropriate, into events. Does not perform collection, scoring, decision-making, or AI enrichment itself — it delegates to the relevant engine and reads back persisted results. All read orchestration — pagination, filtering, sorting, search, and assembling API-facing DTOs — is delegated to the Application Layer (`packages/application`); the Backend itself never composes a database query.

### Application Layer

Owns every read path between the durable, Opportunity-centric persistence in `packages/db` and everything that consumes it: the public API, and Server Components rendered directly in `apps/web`. Exposes query services (`OpportunityQueryService`, `CompanyQueryService`, `SearchService`) that return stable, API-facing DTOs/View Models — never a raw database row — with pagination, filtering, sorting, and search composed once, here, rather than duplicated per consumer. It is the *only* package permitted to compose a multi-table read query against `packages/db`'s schema; every UI component and every API route calls into it instead of querying directly. See [§6](#6-package-boundaries) for its dependency boundary and [§9](#9-design-constraints) for the access-pattern rule this enables.

### Collectors

Source-specific adapters (career pages, ATS providers, funding trackers, grant registries, hackathon results, GitHub, engineering blogs, RSS/news). Each collector's only job is to retrieve raw data from one source and hand it to the Ingestion Pipeline. Collectors are dumb by design and deliberately thin: they fetch, and they supply their own pure normalizer function (source-specific field mappings, no side effects) for the Ingestion Pipeline to invoke later — they do not persist anything, do not publish anything, do not infer hiring intent, and have no concept of an Opportunity.

### Ingestion Pipeline

Owns everything between "a Collector fetched something" and "a Canonical Event exists": immutable Raw Record persistence (content-hash-deduplicated, so re-fetching identical content is a no-op), running a Collector-supplied normalizer against unprocessed Raw Records, publishing the resulting Canonical Event, and recording the Raw Record → Event provenance link. This is the piece that makes "add a new Collector" cheap: a new source supplies a fetcher and a normalizer function; the persistence, deduplication, and publishing machinery is shared and requires no changes. See [Design Constraints](#9-design-constraints) for why this — not the Collector — is the only thing besides `packages/events` allowed to touch the database.

### Scheduler

Owns *when* collection happens: polling cadence, backoff, rate-limit compliance per source, and retry policy. Decouples "how often does this source need to be checked" from the collector's own logic, so scheduling policy can change without touching collector implementations.

### Event Bus

The system's central nervous system. Collectors, the Scoring Engine, the Decision Engine, the AI Layer, the Backend, and the CRM all emit typed, immutable events. Every other subsystem consumes from it independently. No subsystem calls another subsystem directly to communicate a fact — it emits an event and lets interested consumers react.

### Scoring Engine

Consumes raw events and correlates them — across a company, a specific role signal, and related ecosystem activity — into **Opportunities**: the platform's central, scored, explainable unit of "something a user might act on." Computes hiring-likelihood and per-user relevance scores for each Opportunity, always with a stored reference back to the events that justified them. This is the subsystem responsible for `HiringSignalDetected` and `OpportunityDetected`/`OpportunityScored` events. It does **not** decide what to do about a score — that is the Decision Engine's job.

### Decision Engine

Owns every deterministic business decision made about an Opportunity: whether it becomes a recommendation, whether and when a user is notified, whether it's included in a given day's digest, whether a follow-up should be scheduled, and how outreach candidates are prioritized against each other. Consumes Opportunities and their scores, applies explainable, versioned business rules, and publishes decision events (`OpportunityRecommended`, `NotificationTriggered`, `DigestEntrySelected`, `FollowUpScheduled`, `OutreachPrioritized`). Contains no AI calls and no non-deterministic logic — identical inputs always produce identical decisions, which is what keeps the system's behavior predictable and debuggable as rules evolve.

### AI Layer

Consumes the Decision Engine's published decisions — not raw scores — to produce enrichment: plain-language explanations, Opportunity/company summaries, and personalized outreach drafts (`AIRecommendationGenerated`). AI never decides whether something is worth recommending, notifying on, or prioritizing; the Decision Engine has already made that call by the time the AI Layer runs. Its role is strictly to explain and generate content for decisions already made — see [Design Constraints](#9-design-constraints).

### Search

Maintains query-optimized read models over Opportunities and companies, built by consuming events and persisted state. Exists so the dashboard never has to run expensive ad hoc queries against the system of record.

### Notifications

Delivers what the Decision Engine has already decided, using the content the AI Layer has already generated. Owns channel mechanics (email, push, in-app), message formatting/assembly, and send-time delivery tracking. It does not decide what qualifies for a digest or how often a user is notified — that logic lives entirely in the Decision Engine. This split keeps "should we notify" (a business rule, testable in isolation) separate from "how do we notify" (a delivery mechanic), and is directly responsible for upholding the [Product Principle](./PRODUCT.md#9-product-principles) of prioritizing quality over quantity.

### CRM

Owns user-specific relationship state against Opportunities and companies: saved items, outreach status, and notes. Surfaces the follow-up reminders the Decision Engine schedules (`FollowUpScheduled`) and publishes events when the user acts (e.g., `ApplicationSubmitted`). The CRM does not itself decide when a follow-up is warranted — it stores and surfaces the Decision Engine's determination. Explicitly *not* a hiring-pipeline ATS — see [Non-Goals](./PRODUCT.md#8-non-goals).

---

## 3. Monorepo Structure

```text
apps/
  web/                  Frontend + Backend (Next.js). User-facing surface only.

packages/
  db/                   System of record. Schema, migrations, typed data access.
  ingestion/             Raw Record persistence + the generic ingestion pipeline runner.
  collectors/            Source adapters: fetch + a pure normalizer function. One module per source.
  scoring/               Scoring Engine: event correlation into Opportunities + explainable scoring.
  decision/              Decision Engine: deterministic business decisions.
  ai/                    AI Layer: enrichment, summarization, content generation.
  application/            Application Layer: read models, query services, API-facing DTOs.
  events/                Canonical event contracts, the event-type registry, publish, and replay.
  notifications/         Decision delivery: channel mechanics and send tracking.
  shared/                Cross-cutting, domain-agnostic utilities and types.
  ui/                    Presentation-only component library (no business logic, no data fetching).
```

### Ownership boundaries

- **`apps/web`** is the only package allowed to depend on nearly everything else. Nothing depends on `apps/web`. It contains no domain logic of its own beyond request handling, authorization, and composition — see [Design Constraints](#9-design-constraints).
- **`packages/db`** is the *only* package permitted to talk to the database. Every other package that needs persisted data goes through `packages/db`'s typed access layer — never around it.
- **`packages/events`** owns the canonical shape of every event in the system, the event-type registry (see [§4](#4-event-driven-architecture)), and both publishing *and replay*. It depends on `packages/db` for generic, event-agnostic persistence primitives (the `event`/`event_provenance` tables, a query builder) but composes every event-domain-specific behavior — validation against the registry, ordering guarantees, filtering semantics — itself. This is a deliberate, narrow exception to "`packages/db` is the only package with direct persisted-data access via its own typed layer": `packages/db` still owns the schema and the only database connection in the system, but the domain logic of *what a replay means* belongs with the concept it's replaying, not with the generic persistence package. `packages/db` itself exposes no event-specific behavior — no "replay," no "get events by collector" — only generic schema and query access; every other producer and consumer package depends on `packages/events` for types and for reading history back.
- **`packages/ingestion`** owns immutable Raw Record persistence, content-hash deduplication, and the generic pipeline that turns a Raw Record into a Canonical Event: given a Collector-supplied normalizer function, it runs it, calls `packages/events`' `publishEvent`, and records the Raw Record → Event provenance link. It depends on `packages/events` (to publish), `packages/db` (to persist Raw Records), and `packages/shared` (generic, domain-agnostic utilities, e.g. deterministic ID derivation) — the first two are a second, identically-justified exception to "only `packages/db` and `packages/events` touch the database directly," for the same reason `packages/events` has one: the domain logic of *what ingestion means* belongs with the concept, not with the generic persistence package. `packages/ingestion` knows nothing about any specific source — the normalizer it runs is supplied by the caller, never written here — which is what makes it reusable across every future Collector unchanged.
- **`packages/collectors`** depends on `packages/ingestion` and `packages/shared` only. It never depends on `packages/events` or `packages/db` directly, and never depends on `packages/scoring`, `packages/decision`, or `packages/ai`. A Collector's entire job is fetching and supplying a pure normalizer function to `packages/ingestion` — reaching into persistence or publishing logic directly has violated its boundary.
- **`packages/scoring`** depends on `packages/events`, `packages/db` (to read the facts it correlates and to persist Opportunities and their explainable scores), and `packages/shared` (generic utilities, e.g. deterministic ID derivation). It never depends on `packages/decision`, `packages/ai`, or `packages/collectors`.
- **`packages/decision`** depends on `packages/events` and `packages/db` (to read Opportunities/scores and persist decisions). It never depends on `packages/ai` — a deterministic decision must never be able to reach for a non-deterministic dependency — and never depends on `packages/scoring` or `packages/collectors` internals.
- **`packages/ai`** depends on `packages/events` and `packages/db` (read-only for context, write-only for its own enrichment/content records). It never depends on `packages/decision` or `packages/scoring` internals — it learns what to enrich exclusively by consuming published decision events, and it never writes to Opportunity, score, or decision records.
- **`packages/notifications`** depends on `packages/events` and `packages/db`. It never depends on `packages/ai` or `packages/decision` internals beyond reading their published, persisted outputs, and it contains no logic that decides *whether* or *how often* to notify.
- **`packages/application`** depends on `packages/db` and `packages/shared` only — it never depends on `packages/scoring`, `packages/decision`, `packages/ai`, `packages/collectors`, `packages/ingestion`, or `packages/events`, since it only reads already-materialized projections those packages write (Opportunity, Signal, Company Intelligence, Company), never raw events or business logic. It is the sole owner of read-side query composition: pagination, filtering, sorting, search, and the API-facing DTOs/View Models every consumer receives instead of a raw database row. `apps/web` is the only package allowed to depend on it — see [§9](#9-design-constraints) for the access-pattern rule this establishes.
- **`packages/ui`** depends on nothing but its own primitives (and `packages/shared` for generic types). It has no awareness of collectors, scoring, decisions, AI, or events. This keeps it reusable and trivially testable in isolation.
- **`packages/shared`** depends on nothing inside the monorepo. It exists for genuinely domain-agnostic code (generic types, formatting utilities). It is the one package every other package is allowed to depend on — but it must never grow domain logic, or it becomes a dumping ground that reintroduces coupling.

### Rule: dependency direction is one-way

`apps/web → packages/{ai,decision,scoring,notifications,collectors,ingestion,db,ui,shared,events,application}`, and within `packages/`, dependencies point only toward `events`, `ingestion`, `db`, and `shared` — never sideways between domain packages (`collectors` ↛ `scoring`, `scoring` ↛ `decision`, `decision` ↛ `ai`, etc.) and never back up toward `apps/web`. `packages/application` is a special case of this same rule, not an exception to it: it depends only on `packages/db` and `packages/shared`, exactly like a domain package would. `packages/events → packages/db` and `packages/ingestion → {packages/events, packages/db}` are the only exceptions to "nothing depends on `db` except through its own layer," and both are one-way and terminal: `packages/db` never depends on `packages/events` or `packages/ingestion`, and `packages/events` never depends on `packages/ingestion`, so no cycle is introduced. Communication between domain packages happens through events, not imports. A circular dependency between any two packages is treated as a design defect, not a lint warning to suppress.

**Note:** the pipeline order described in [§5](#5-data-flow) (Scoring → Decision → AI) is a sequence of *event consumption*, not an import chain. `packages/decision` does not import `packages/scoring`, and `packages/ai` does not import `packages/decision` — each depends only on `packages/events` and `packages/db`, and learns what the previous stage did exclusively by consuming the events it published. This is what keeps the pipeline reorderable, independently testable, and free of the sideways coupling a naive "engine calls the next engine directly" implementation would introduce.

---

## 4. Event-Driven Architecture

Every meaningful fact and decision in the system is modeled as an event, falling into four categories:

**Source events** — facts observed directly from external sources by collectors, after normalization and deduplication:
- `CompanyFunded`
- `JobPosted`
- `GrantAwarded`
- `RepositoryCreated`
- `FounderActivityDetected`
- `CompanyUpdated`

**Opportunity events** — produced by the Scoring Engine as it correlates source events into the platform's central actionable entity:
- `HiringSignalDetected` — an early or partial signal, not yet a full Opportunity
- `OpportunityDetected` — a new Opportunity has been correlated and scored for the first time
- `OpportunityScored` / `OpportunityUpdated` — an existing Opportunity's score has changed as new corroborating events arrive

**Decision events** — produced by the Decision Engine applying deterministic rules to Opportunities:
- `OpportunityRecommended`
- `NotificationTriggered`
- `DigestEntrySelected`
- `FollowUpScheduled`
- `OutreachPrioritized`

**AI / enrichment events** — produced by the AI Layer generating content for decisions already made, and user-originated events from the Backend/CRM:
- `AIRecommendationGenerated`
- `ApplicationSubmitted`

### Why events instead of tightly coupled business logic

- **Decoupling of producers and consumers.** A collector that detects a funding round does not need to know that scoring, search indexing, and the Decision Engine all care about that fact. It emits one event; every interested subsystem subscribes independently. New consumers can be added without touching producers.
- **Explainability by construction.** Because events are immutable and every derived event references the raw events that produced it, the reasoning chain behind any score, decision, or recommendation is always reconstructable. This is not a feature we build on top of the data model — it's a property the data model gives us for free.
- **Deterministic decisions stay auditable and swappable.** Modeling decisions as their own event category — distinct from both raw signals and AI content — means "is this worth surfacing" has a definite, stable answer with a stored reason, independent of any model's non-determinism. We can change AI providers, prompts, or even remove AI enrichment entirely for a given surface, and the Decision Engine's behavior (and every downstream notification/digest/recommendation) is unaffected.
- **Resilience and independent scaling.** If the AI Layer is slow or temporarily down, collection, scoring, and decision-making continue unaffected — they don't call the AI Layer synchronously, and a delayed `AIRecommendationGenerated` event only delays enrichment content, never the underlying decision. Each subsystem can be scaled or degraded independently.
- **Replay and backfill.** Improving the scoring model, the decision rules, or shipping an entirely new consumer (e.g., a future "warm-intro graph," see [Future Vision](./PRODUCT.md#11-future-vision)), means replaying the existing event history rather than needing new data collection.
- **A natural audit log.** "Why did I get this recommendation, and why today" is answered by walking the event chain from `OpportunityRecommended` back through the Opportunity's scoring evidence to the raw source events — not by reverse-engineering current-state database rows.

Events are the contract between subsystems. Direct function calls are appropriate *within* a subsystem's own internal logic, but crossing a subsystem boundary happens through the event bus, not through importing another domain package's internals.

---

## 5. Data Flow

```text
Collectors → Raw Record Storage → Normalization → Deduplication → Event Creation → Scoring (Opportunity Correlation) → Decision → AI Enrichment → Persistence → Dashboard
```

1. **Collectors** retrieve raw data from a single external source, in that source's native shape, and hand it — along with a pure normalizer function for their source — to the Ingestion Pipeline. A Collector never persists anything and never publishes anything itself.
2. **Raw Record Storage** (Ingestion Pipeline) persists what a Collector fetched immutably, deduplicated by content hash: re-fetching identical content is a no-op, not a new record. This is what makes reprocessing idempotent and gives every downstream Canonical Event something concrete to cite as provenance.
3. **Normalization** (Ingestion Pipeline, running the Collector-supplied function) transforms a source-specific Raw Record into a canonical internal shape (a `JobPosted` fact looks the same regardless of whether it came from Greenhouse, Ashby, or a plain career page). This is where source quirks are absorbed so nothing downstream needs to know where a fact came from.
4. **Deduplication** resolves the same real-world fact reported by multiple sources (e.g., a role cross-posted to both a career page and an ATS) or reported again on a subsequent poll, into a single canonical fact. This includes entity resolution for companies — collapsing "Acme Labs," "Acme Labs Inc.," and an ENS-style identifier into one canonical company identity where possible. This is distinct from, and happens *before*, Opportunity-level correlation in the next stage: deduplication asks "is this the same fact reported twice," Scoring asks "do these different facts describe the same emerging Opportunity."
5. **Event Creation** (Ingestion Pipeline) publishes the deduplicated, normalized fact as an immutable event onto the event bus, via `packages/events`' `publishEvent`, recording the Raw Record it was normalized from as provenance. This is the boundary past which nothing in the system deals in "raw source payloads" again — only typed events.
6. **Scoring (Opportunity Correlation)** consumes raw events and correlates them — across a company, a specific role signal, and related ecosystem activity — into Opportunities. This is the step where the shift from "facts about a company" to "a specific thing a user could act on" happens. Each Opportunity is scored for hiring-likelihood and per-user relevance, with every score referencing the events that produced it, publishing `OpportunityDetected`/`OpportunityScored` (and, where a signal is real but not yet a full Opportunity, `HiringSignalDetected`).
7. **Decision** consumes Opportunities and their scores and applies deterministic, versioned business rules to decide what happens next: is this worth recommending, does it cross the threshold for a notification, does it belong in today's digest, does a follow-up need to be scheduled, how does it rank against other outreach candidates. Publishes decision events. This stage never calls an AI model and never varies its output for identical input — its entire job is to be predictable.
8. **AI Enrichment** consumes the Decision Engine's output — never raw scores directly — and generates the content needed to act on that decision: a plain-language explanation, a summary, or a personalized outreach draft. AI runs only for Opportunities the Decision Engine has already determined are worth this treatment; it is never used to decide relevance itself, only to explain and articulate a decision already made. Publishes `AIRecommendationGenerated`.
9. **Persistence** consumes events across every stage and writes the durable, queryable read models the rest of the system reads from, with the **Opportunity as the primary entity**: its current score, its decision state, and its AI-generated content are all projections attached to one Opportunity record. The event log itself remains the durable source of truth, independent of these projections.
10. **Dashboard** reads exclusively from persisted, Opportunity-centric read models (via the Backend and Search) — never from the event bus directly and never by invoking Scoring, Decision, or AI synchronously on page load.

This pipeline is intentionally staged and unidirectional. Each stage has one responsibility, consumes only from the stage(s) before it, and its output is the only thing the next stage depends on.

---

## 6. Package Boundaries

### `apps/web`

The user-facing Next.js application: frontend rendering and the backend API/server-action surface consumed by it. Organized feature-first per [CLAUDE.md](../CLAUDE.md), with `features/opportunities` as the natural home for the platform's central entity. Contains authorization, request orchestration, and composition of data from packages — no scoring, decision, enrichment, or collection logic. Business logic is imported, not written here.

### `packages/db`

The system of record: schema, migrations, and the only typed data-access layer in the repository. Owns the durable event log and the derived read-model tables — with the Opportunity table as the central entity that scores, decisions, and AI content all attach to. No other package is permitted a direct database connection.

### `packages/ingestion`

Owns immutable Raw Record persistence, content-hash deduplication, and the generic pipeline that runs a Collector-supplied normalizer function, publishes the resulting Canonical Event, and records the Raw Record → Event provenance link. Contains no source-specific logic of its own — the normalizer it runs is always supplied by the caller — which is exactly what makes it reusable across every Collector without modification.

### `packages/collectors`

One module per external source. Owns retrieval only: fetching from that source and supplying a pure normalizer function (source-specific field mappings, no side effects) for `packages/ingestion` to run. Contains no persistence, no publishing, no scoring, decision, or hiring-intent logic, and has no concept of an Opportunity — a collector reports facts about companies and the ecosystem, nothing more.

### `packages/scoring`

The Scoring Engine. Consumes raw events and correlates them into Opportunities — the platform's central actionable entity — computing hiring-likelihood and per-user relevance scores and persisting them with their supporting evidence (the event references that justify the score). Owns the "is this a real, scored Opportunity" logic. Does not decide what to do with an Opportunity once scored.

### `packages/decision`

The Decision Engine. Consumes Opportunities and their scores and applies deterministic, versioned business rules to produce recommendations, notification triggers, digest selections, follow-up schedules, and outreach prioritization. The sole owner of "what should happen as a result of this score" logic. Contains no AI calls and no other non-deterministic dependency — this is what keeps it predictable and independently testable, and what makes "AI never becomes the source of truth" (see [§9](#9-design-constraints)) an enforceable rule rather than a hope.

### `packages/ai`

The AI Layer. Consumes the Decision Engine's published decisions — not raw scores — to generate summaries, explanations, and personalized outreach drafts. Owns prompt construction, model invocation, and grounding of generated content in cited events. Never decides relevance, priority, or timing; those are already settled by the time this package runs.

### `packages/application`

The Application Layer. Sits between `packages/db` and every consumer of persisted data — the public API and `apps/web`'s Server Components — and owns all read-side orchestration: `OpportunityQueryService`, `CompanyQueryService`, and `SearchService` compose the pagination, filtering, sorting, and search queries a browsable feed and detail pages need, and return stable, API-facing DTOs/View Models (e.g. `OpportunityFeedItemDTO`, `OpportunityDetailDTO`, `CompanyProfileDTO`, `SearchResultDTO`) rather than leaking `packages/db` row shapes to any consumer. Read-only: it never writes to `packages/db` and never publishes an event. This is what makes "no UI component or API route composes a database query" an enforceable rule rather than a convention — see [§9](#9-design-constraints).

### `packages/shared`

Domain-agnostic types and utilities used across multiple packages (e.g., generic result/error types, date/formatting helpers). Contains no domain concepts (no `Company`, no `Opportunity`, no `Score`). If a type or utility is specific to one domain, it belongs in that domain's package, not here.

### `packages/ui`

Presentation-only component library: primitives and composed components with no data fetching, no business logic, and no awareness of any other domain package. Consumed by `apps/web`.

### `packages/notifications`

Delivers what the Decision Engine decided and the AI Layer wrote: owns channel mechanics (email, push, in-app), message formatting/assembly, and send-time delivery tracking. Contains no logic about whether or how often to notify a user — that is a Decision Engine concern. This package answers "how do we deliver this," never "should we."

---

## 7. Engineering Principles

- **Feature-first architecture.** Within `apps/web`, code is organized by domain (`features/opportunities`, `features/companies`, `features/crm`, ...), not by technical layer, per [CLAUDE.md](../CLAUDE.md). The monorepo's package split is a *second*, coarser axis of separation (by subsystem responsibility); it does not replace feature-first organization inside `apps/web` itself.
- **Separation of concerns.** Each package and each subsystem has exactly one reason to change. Collection changes when a source changes its API. Scoring changes when correlation/matching logic changes. Decision changes when a business rule changes. AI changes when prompting/enrichment quality changes. These should never be the same pull request.
- **Deterministic vs. probabilistic separation.** Every decision about what a user sees and when is deterministic and independently testable (Decision Engine); every piece of generated content is clearly scoped as enrichment (AI Layer). This means the system's core business behavior never depends on a model's non-determinism, and changing AI providers or prompts can never change *what* gets recommended — only how it's explained.
- **Dependency direction.** Dependencies point from application toward infrastructure and from domain packages toward `events`/`db`/`shared`, never sideways or backward (see [§3](#3-monorepo-structure)). This is enforced structurally, not just by convention — a domain package physically cannot import another domain package's internals if the boundary is respected.
- **Composition over inheritance.** Subsystems compose by subscribing to shared event contracts, not by extending shared base classes or sharing mutable state. A new collector, a new decision rule, or a new notification channel is added by writing a new module that speaks the existing event contract, not by modifying a shared hierarchy.
- **Explainability.** Every score, every decision, and every AI-generated artifact must carry a traceable reference to the events (and, for AI, the decision) that produced it. An unexplainable score or an unexplained recommendation is a defect, not a shipping edge case — this is a direct architectural consequence of the [Product Principle](./PRODUCT.md#9-product-principles) of the same name.
- **Observability.** Every event carries enough context (source, timestamp, correlation identifiers) to trace a single fact all the way from collection through scoring, decision, enrichment, and delivery. Collector health (failure rate, staleness per source), event processing lag, and decision/scoring/AI latency are first-class operational signals, not afterthoughts — this system's value proposition depends on signals being timely, so staleness is a product-critical metric, not just an ops one.

---

## 8. Scalability

The architecture is designed to scale from a single user to hundreds of thousands without a structural rewrite, because the expensive parts of the system scale independently of user count:

- **Collection cost is a function of tracked sources, not users.** A career page or GitHub org is scraped once regardless of how many users are interested in the resulting Opportunity. This is the single most important scaling property of the design: collection cost grows with the ecosystem being watched, not with the user base watching it.
- **Opportunity detection and base scoring are computed once per Opportunity, not per user.** Correlating events into an Opportunity and computing its hiring-likelihood score are properties of the Opportunity itself, derived once from company/ecosystem events, and reused across every user who might match. Only the final per-user relevance ranking, and the Decision Engine's per-user decisions (notify this user, include in this user's digest), are user-scoped — and both operate against an already-small, pre-scored candidate set rather than the full event stream, which is what keeps that cost bounded as the user base grows.
- **The Decision Engine's per-user evaluation is deliberately cheap and rule-based, not model-based.** Because it contains no AI calls (see [§6](#6-package-boundaries)), evaluating "should user X be notified about Opportunity Y" at scale is a fast, deterministic rule check, not an expensive inference call — this is what makes it feasible to run per-user, per-Opportunity, at high volume.
- **AI enrichment cost is bounded by decisions, not by raw Opportunity volume.** Because the AI Layer only runs for what the Decision Engine has already selected (a recommendation, a digest entry, an outreach draft), enrichment cost scales with actioned decisions per user, not with the full universe of scored Opportunities — this keeps AI spend proportional to delivered value rather than to ingestion volume.
- **The event bus decouples throughput per subsystem.** If notification volume grows faster than scoring volume, Notifications can be scaled independently without touching Scoring or Collectors. No subsystem's scaling needs become another subsystem's bottleneck.
- **Read paths are served by projections, not live computation.** The dashboard and search never trigger scoring, decision, or AI work synchronously — they read precomputed, indexed state. This keeps user-facing latency flat as data volume grows.
- **Collectors scale horizontally and independently.** Each source's collector runs on its own schedule and failure domain; adding the 200th source does not slow down the first.
- **The event log enables safe reprocessing at scale.** As scoring models or decision rules improve, reprocessing history is a backfill job against the log, not a risky live migration of mutable state.

The one deliberate constraint this places on later implementation: **per-user computation must stay confined to final ranking and the Decision Engine's rule evaluation.** Opportunity detection and scoring must never be recomputed per user, and AI enrichment must never run for an Opportunity the Decision Engine hasn't selected. Any design that violates either is an architectural regression and should be rejected in review.

---

## 9. Design Constraints

These rules are non-negotiable. A pull request that violates one of these should not be approved regardless of how well-tested or well-intentioned it is.

- **Collectors never write directly to UI-facing models.** A collector's output is a raw payload handed to `packages/ingestion`, full stop. It has no knowledge of how that fact will eventually be displayed.
- **Collectors never persist or publish directly.** Fetching is a Collector's job; storing the Raw Record, deduplicating it, running the normalizer, and publishing the resulting Event all belong to `packages/ingestion`. A Collector that imports `packages/db` or `packages/events` has violated its boundary.
- **Collectors never infer intent, and have no concept of an Opportunity.** Detecting that "a company posted a job" is a collector's job. Correlating that into an Opportunity and scoring its hiring likelihood belongs to the Scoring Engine; deciding what to do about that score belongs to the Decision Engine. Blurring this line is how unexplainable, unmaintainable logic creeps into ingestion code.
- **AI never becomes the source of truth, and AI never decides.** Every recommendation, notification, digest inclusion, follow-up, and outreach priority is decided by the Decision Engine using deterministic rules before the AI Layer ever runs. AI's output is always content generated *for* a decision already made — never the basis for the decision itself.
- **The Decision Engine never calls an AI model or any other non-deterministic dependency.** If a rule ever needs to react to AI output, that output must first be persisted as a fact the Decision Engine can read deterministically on a later pass — the decision itself always stays rule-based, versioned, and reproducible.
- **Scores and decisions must always be explainable.** A score or decision with no stored reference to the events that produced it must not be persisted or surfaced. "The model said so" is not an acceptable explanation for either a score or a decision.
- **Opportunities, not raw company facts, are the unit users act upon.** Every user-facing surface — dashboard, digest, notification, CRM entry — is keyed to an Opportunity, not directly to a raw event or a bare company record.
- **Business logic never lives in React components.** Components render state and dispatch actions. Correlation, scoring, decision, and enrichment logic live in their respective packages, never in `apps/web`'s component tree.
- **No package reaches around `packages/db` to access data directly.** There is exactly one system of record and exactly one typed path to it.
- **No UI component or API route composes a database query.** `packages/application` is the only package allowed to do that. The access pattern is: browser clients consume the public API; API routes call `packages/application`; `apps/web` Server Components may call `packages/application` directly (no same-origin HTTP hop needed for work already happening server-side). What must never happen is a component or route reaching past `packages/application` into `packages/db` itself.
- **Domain packages do not import each other's internals.** Cross-domain communication happens through `packages/events`, not through direct imports between `collectors`, `scoring`, `decision`, `ai`, and `notifications`.
- **Events are immutable.** A published event is never edited or deleted. A correction is a new event, not a mutation of history — this is what makes the audit trail and explainability guarantees hold.

---

## 10. Open Questions

Decisions that must be made before implementation begins, in rough priority order:

1. **Event bus technology.** Whether the bus is backed by a managed queue, a Postgres-based outbox/log pattern, or a dedicated streaming platform has real cost, operational complexity, and latency implications at our expected scale. Needs a dedicated decision, likely alongside the infrastructure/hosting decision.
2. **Opportunity lifecycle and identity.** When do multiple raw events collapse into a single Opportunity versus produce separate ones (e.g., two distinct roles at the same company during a hiring surge), and how does an Opportunity's identity persist as new corroborating events arrive over time (`OpportunityUpdated`)? This needs explicit design before the Scoring Engine's correlation logic is implemented — it is the single riskiest piece of business logic in the system.
3. **Decision rule authoring and versioning.** Whether Decision Engine rules are expressed as code, a config/DSL, or a rules-engine product affects how product stakeholders — not just engineers — can tune thresholds like digest inclusion or notification frequency, and how rule changes are audited over time.
4. **Entity resolution strategy for companies.** How confidently and by what method (name matching, domain matching, on-chain identifiers) we deduplicate the same company across sources materially affects Opportunity quality and needs to be designed deliberately, not improvised inside the first collector that's built.
5. **Real-time vs. batch dashboard updates.** Whether the dashboard reflects new events live (websockets/SSE) or on a refresh/polling cadence affects both infrastructure choices and perceived product responsiveness.
6. **AI model provider strategy and cost containment.** Outreach generation and enrichment run per Opportunity, per user — the cost model needs to be understood before this is built at any scale, including caching/reuse strategy for Opportunity-level summaries versus per-user personalization.
7. **Legal/ToS review per collected source.** Several intended sources (career pages, ATS boards) may have scraping or terms-of-service constraints that affect which collectors are viable at all. This is a legal and product decision, not just an engineering one, and should be resolved before collector implementation, not discovered during it.
8. **Data retention policy.** How long raw source events, superseded Opportunity states, and AI-generated drafts are retained, particularly for data scraped from third parties.
9. **Authentication/identity strategy.** Not yet decided, and it affects the shape of the CRM and personalization data models.
10. **CRM package boundary.** The CRM subsystem is described functionally in [§2](#2-high-level-system-overview) but deliberately left out of the initial package list in [§6](#6-package-boundaries) — its role is now narrower than before, since the Decision Engine owns follow-up *timing* and CRM only stores and surfaces the result. At initial scale it can likely live as a feature within `apps/web` backed directly by `packages/db`; whether it needs to graduate into its own package should be revisited once its logic exists, not decided speculatively now.

---

This document should be updated whenever an architectural principle changes. It should not be updated to describe individual feature implementations — those belong in code, tests, and, where a genuine architectural decision was made, a dated addition to [§10](#10-open-questions) resolved and moved into the relevant section above.
