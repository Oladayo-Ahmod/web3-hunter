# Web3 Hunter — Database Design

Status: Draft v0.1
Owner: Engineering
Depends on: [docs/PRODUCT.md](./PRODUCT.md), [docs/ARCHITECTURE.md](./ARCHITECTURE.md), [docs/DOMAIN_MODEL.md](./DOMAIN_MODEL.md), [docs/EVENT_MODEL.md](./EVENT_MODEL.md)

This document is the authoritative reference for how Web3 Hunter's data is persisted. It defines persistence *architecture* — philosophy, storage classification, aggregate boundaries, and conventions — not schemas. Every table, index, and migration written later should be traceable back to a decision made here; if it isn't, this document is wrong or incomplete, and should be corrected before the implementation is trusted.

---

## 1. Database Philosophy

The database exists to **persist** the domain model — it does not get to **define** it. [DOMAIN_MODEL.md](./DOMAIN_MODEL.md) already establishes what a Company, an Opportunity, a Match, and a Recommendation *are* and how they relate; [EVENT_MODEL.md](./EVENT_MODEL.md) already establishes how facts about the world become immutable, canonical history. The persistence layer's only job is to make both of those durable and queryable at the latency and scale the product needs. If a storage concern ever appears to require inventing a new business concept, that concept belongs in the Domain Model first — the database is downstream of meaning, never the other way around.

This gives three layers a precise relationship to one another:

- **Domain Model** — the vocabulary and rules. What things mean, how they relate, what must always be true.
- **Event Model** — the historical record. What actually happened, in the order it happened, forever.
- **Persistence Model** (this document) — the storage mechanism. How the Event Model's history is stored durably, and how the Domain Model's entities are made fast to read without replaying that history on every request.

This produces a strict, load-bearing distinction between what is **persisted permanently**, what is **derived**, and what can be **recomputed**:

- **Persisted permanently:** the canonical event log — every event, in every category defined in [EVENT_MODEL.md §Event Categories](./EVENT_MODEL.md#event-categories) — plus a small set of genuinely opaque artifacts that have no upstream event-equivalent to regenerate them from (the clearest example is a Resume's raw file content; see [§2](#2-storage-strategy)). This is the only data whose loss is unrecoverable, and it is treated with that seriousness.
- **Derived:** every "current state" view of a domain entity — a Company's profile, an Opportunity's score, a Match, a Recommendation row. Per [ARCHITECTURE.md §1](./ARCHITECTURE.md#1-architectural-philosophy), "the system does not model records that get updated, it models facts that happened" — so anything that looks like a mutable record in the schema is, conceptually, a materialized projection of the event log, kept incrementally up to date for performance, not an independent source of truth.
- **Recomputed:** read models built for specific query patterns (see [§6](#6-read-models)) and caches (see [§7](#7-performance-strategy)). These can be dropped and rebuilt entirely from canonical storage with zero information loss, by design.

One nuance matters here and recurs throughout this document: replay reconstructs *deterministic* state exactly, but not everything in the pipeline is deterministic. AI-generated content (an outreach draft, an explanation) is not guaranteed to be byte-identical if regenerated from scratch — the same Decision, re-enriched, might produce different phrasing. This is why the AI Layer's output is captured verbatim *inside* its canonical event (`AIRecommendationGenerated`, per [EVENT_MODEL.md](./EVENT_MODEL.md#event-categories)) rather than treated as something safely re-derivable on demand: replay must always replay the *stored* content, never re-invoke the model, or history would silently drift each time it's rebuilt.

---

## 2. Storage Strategy

Every domain concept is classified along four axes:

- **Canonical** — the source of truth. Its loss is unrecoverable; nothing else can regenerate it.
- **Derived** — computed or materialized from canonical data. Fully rebuildable by replaying the event log. Kept incrementally in sync for performance, never authoritative in its own right.
- **Cached** — a derived value kept for latency or cost reasons, explicitly allowed to be stale within a bounded window, and safe to evict or recompute on demand with zero correctness risk.
- **Ephemeral** — transient, not durably persisted, or persisted only for the life of a session or request. Safe to lose entirely with no product impact.

| Concept | Classification | Why |
|---|---|---|
| Event | Canonical | The append-only source of truth defined in [EVENT_MODEL.md](./EVENT_MODEL.md). Nothing else in the system can regenerate a lost event. |
| Company | Derived | A materialized rollup of Company Events (and every other event category that touches that company). Kept synchronously up to date because so much of the system references it as a stable identity, but fully rebuildable by replay. |
| Signal | Canonical (its detection) + Derived (its current weight) | Each detection or decay is an immutable Intelligence Event — that historical fact is canonical. The live, decay-adjusted weight the Scoring Engine reads day to day is a continuously recomputed projection over that history. |
| Intelligence | Derived | Explicitly defined in [DOMAIN_MODEL.md](./DOMAIN_MODEL.md#intelligence) as the accumulated rollup of Signals — never independently authored, always rebuildable from the Signal/Event history for its Company. |
| Opportunity | Derived | Materialized once a Company's Intelligence crosses a confidence threshold. The platform's central actionable entity is a projection, not independently authored data — see [DOMAIN_MODEL.md §1.1](./ARCHITECTURE.md#11-companies-produce-events-events-produce-opportunities-opportunities-are-what-users-act-on). |
| Match | Derived | A computed fit assessment, recomputed whenever the User Profile or the Opportunity changes. Superseded versions are retained (not overwritten) for audit and explainability, but the concept itself is reproducible given a pinned scoring-algorithm version (see [§4](#4-database-schema-principles)). |
| Recommendation | Derived, with canonical content once generated | The row is a projection tying a Decision Engine determination to AI-generated content and delivery/action state. The AI-generated text itself is preserved verbatim inside its canonical event, per the non-determinism caveat in [§1](#1-database-philosophy). |
| Resume | Canonical (as an opaque artifact) | A User's uploaded file has no upstream event from which its bytes could be regenerated. This is a storage classification only — it says nothing about Resume's (deliberately non-authoritative) role in matching; see [DOMAIN_MODEL.md](./DOMAIN_MODEL.md#resume). |
| User Profile | Derived, operated as strongly consistent | Current state is a projection of `UserProfileUpdated` / `UserPreferencesUpdated` events, but it must be read with strong consistency — Matching depends on it directly, and a stale read would silently produce wrong Matches. |
| Contact | Derived | Built and corroborated over time from Founder, Company, and Hiring Events. Confidence-weighted and re-verifiable, per its invariants in [DOMAIN_MODEL.md](./DOMAIN_MODEL.md#contact). |

Two patterns are worth naming explicitly because they recur across almost every row above:

- **"Derived" does not mean "unimportant" or "eventually consistent everywhere."** Company and User Profile are both Derived, yet both are read synchronously and must be current — they're materialized incrementally as events land, not lazily rebuilt on read. Derived describes *where the source of truth lives* (the event log), not *how fresh the projection is allowed to be*.
- **Nothing outside the Event category is ever the sole record of a business fact.** Even Resume — the one concept that is Canonical in its own right — has the fact of its existence and its relationship to a User captured by an event; only its raw bytes sit outside the event log, for the practical reason that large binary content doesn't belong embedded in an event payload (see [§9](#9-open-questions)).

---

## 3. Aggregate Boundaries

An aggregate is a cluster of data with one root entity that owns transactional consistency for everything inside it. Within an aggregate, a single write is atomic. Across aggregates, consistency is eventual — enforced by the event pipeline described in [ARCHITECTURE.md §4](./ARCHITECTURE.md#4-event-driven-architecture), never by a transaction spanning two aggregates. References across aggregate boundaries are always by identity, never by embedding another aggregate's data inside your own.

### Company Aggregate

**Root:** Company. **Owns:** canonical profile fields (name, resolved identity links, funding stage, size) and Tech Stack. Contacts and Intelligence are deliberately *not* embedded here — they change at different rates and are written by different producers (Contact by founder/hiring-signal processing; Intelligence continuously by the Scoring Engine), and folding them into one aggregate would create write contention on a company's core record every time an unrelated Signal arrives.

### Intelligence Aggregate

**Root:** Intelligence (one per Company). **Owns:** the rolled-up Signal history and current weights for that Company. Updated on every Signal contribution or decay pass; references its Company by identity only.

### Opportunity Aggregate

**Root:** Opportunity. **Owns:** its score, lifecycle state, and evidentiary references (Signal/Intelligence/Event provenance, by identity — never embedded copies of the events themselves).

### Match Aggregate

**Root:** Match. **Owns:** the fit assessment between one User Profile and one Opportunity. Deliberately its own aggregate rather than nested under User or Opportunity: a Match is created or recomputed whenever *either* side changes, and neither side should have to be locked or transactionally touched to produce it. A Match is intentionally eventually consistent relative to its inputs — a briefly stale Match only delays a Recommendation, it never produces an incorrect one, because every Recommendation cites the specific Match state it was built from (see [§1](#1-database-philosophy) on explainability over freshness).

### Recommendation Aggregate

**Root:** Recommendation. **Owns:** the Decision Engine's determination, the AI-generated content, and delivery/action state (delivered, actioned, expired). References Match, Opportunity, and User by identity; never reaches into their aggregates transactionally.

### User Aggregate

**Root:** User. **Owns:** User Profile fields, notification/cadence preferences, and a reference to the current Resume (a pointer, not the file content itself — see [§2](#2-storage-strategy)). Edits here are self-contained and User-initiated.

### CRM Aggregate

**Root:** the User's relationship state against Opportunities and Companies. **Owns:** saved items, notes, outreach status, and Follow-ups. Kept separate from the User Aggregate on purpose: Follow-ups are created by the Decision Engine independently of the User ever touching their own Profile, and mixing the two would force unrelated writers to contend for the same aggregate.

### Application Aggregate

**Root:** Application. **Owns:** the submission record and its self-reported status history. References User and Opportunity by identity. Per its [Domain Model invariant](./DOMAIN_MODEL.md#application), an Application transaction never reaches into and alters the Opportunity aggregate it references — status changes here have zero write access to Opportunity data.

### Collector Aggregate

**Root:** Collector. **Owns:** its own configuration and health/status state (Configured → Active → Degraded → Disabled). A small, operational aggregate, but a real one — every Event's Source reference points at a row here.

### Pipeline Run Aggregate

**Root:** Pipeline Run (Milestone 10). **Owns:** one record per invocation of a deterministic pipeline (Scoring, Classification, Technology, Matching, Decision) — its status, timing, and either its result metrics or its error message. Structurally a log, not a snapshot: unlike the Collector Aggregate (one singular entity, one health row, continuously overwritten), these pipelines run once *per* Company/Opportunity/User, repeatedly, so each invocation gets its own row rather than sharing one mutable slot. Deliberately outside the four-axis classification in [§2](#2-storage-strategy) — like Collector Health, this is operational telemetry about *how* the system ran, not a business fact about the world, so it is neither Canonical nor Derived from the event log: no Event is published when a Pipeline Run is recorded, and this table is intentionally excluded from every replay-determinism guarantee (`startedAt`/`completedAt`/`durationMs` are wall-clock-bound and can never be reproduced by replaying the same business data twice).

---

## 4. Database Schema Principles

**Primary keys.** Every table uses a globally unique, non-guessable, creation-time-sortable identifier — never an auto-incrementing integer exposed beyond the database. Event provenance references, cross-aggregate references, and distributed writers (multiple Collectors, multiple Scoring workers writing concurrently) all depend on identifiers that are stable and collision-free without central coordination.

**Foreign keys.** Foreign key constraints may exist across aggregate boundaries purely as a data-integrity backstop (e.g., an Opportunity row referencing its Company) — but no single write transaction ever spans two aggregates, regardless of whether a foreign key connects their tables. The constraint protects against dangling references; it is not evidence of, or license for, transactional coupling.

**Indexes.** Every index exists to serve a named query pattern from a specific read model (see [§6](#6-read-models)) — never added speculatively. Event ingestion is the platform's dominant, ever-growing write load, so unjustified indexes have a real, compounding cost.

**Enums.** Closed-vocabulary fields (Event Type, Application status, Opportunity lifecycle stage, Collector status) use enums backed by the same closed vocabulary already defined in the Domain and Event Model docs — never free text. New values are additive only; existing values are never renumbered or removed, so historical rows remain interpretable, mirroring the additive-evolution principle in [EVENT_MODEL.md §Event Versioning](./EVENT_MODEL.md#event-versioning).

**Soft deletes.** Nothing in this system is truly deleted in the sense of destroying history — that follows directly from events being append-only. Where a row must stop being "live" (a Collector disabled, a Company merged, a Recommendation expired), that is modeled as an explicit state transition, not a delete flag bolted onto every table. Hard deletes are reserved for narrow, explicit cases only: legal/compliance-driven erasure and expiry of genuinely Ephemeral or Cached data (see [§2](#2-storage-strategy)) — never domain history.

**Audit fields.** Every canonical and derived row carries creation and last-updated timestamps at minimum. Derived/materialized rows additionally carry a pointer to the specific Event ID (and its Version) that last produced their current state, so a row's freshness and provenance can be verified without a full replay — this operationalizes the explainability principle at the storage layer, not just at the API layer.

**Versioning.** Three distinct versioning concerns, handled separately:
1. *Event schema versioning* — per Event Type, additive-preferred, never rewritten in place, per [EVENT_MODEL.md](./EVENT_MODEL.md#event-versioning).
2. *Aggregate/read-model schema migrations* — the tables themselves evolve via the standard expand/contract migration discipline (see [§8](#8-evolution-strategy)).
3. *Algorithm/rules versioning* — every Scoring and Decision output records which version of the scoring or decision logic produced it, so historical scores and decisions remain interpretable even after the algorithm changes, and so multiple algorithm versions' outputs can coexist safely during a rollout.

**Naming.** Table and field names mirror [DOMAIN_MODEL.md](./DOMAIN_MODEL.md) and [EVENT_MODEL.md](./EVENT_MODEL.md) terms exactly. If a business term changes meaning, the Domain Model changes first, and the schema follows — the schema is never the place a term's meaning is redefined or reinterpreted.

**Constraints.** Database-level constraints (non-null, uniqueness, referential integrity within an aggregate) act as a backstop against programming errors, not as the primary mechanism for enforcing domain invariants. Rich business rules — "a Match below the relevance floor must never become a Recommendation" — live in application/domain logic (`packages/scoring`, `packages/decision`), because most invariants in this system are too semantically rich for a database constraint to express correctly.

---

## 5. Event Storage

**Immutability.** The event store is append-only at the storage-engine level, not only by convention: the application's write path only ever inserts new event rows, and the runtime database role should have no update or delete grant on the event table at all — immutability the database itself refuses to violate, not merely a rule engineers are trusted to remember.

**Versioning.** Every stored event row records its Event Type and Version explicitly and permanently, per [EVENT_MODEL.md](./EVENT_MODEL.md#event-versioning). The store never migrates a historical event's payload to a newer version's shape in place; any translation between versions happens at read time, in an explicit adapter, not by touching stored rows.

**Replay.** Because every derived table is defined (§1, §2) to be rebuildable from the event store, efficient replay — sequential, and filtered by Company, Event Type, or time range — is a first-class access pattern, not an afterthought. Replay is how new read models get backfilled, how a scoring-algorithm change gets reprocessed against history, and how a corrupted derived table gets repaired. Replay must be idempotent: re-processing the same event twice must produce the same resulting state, since backfill and repair jobs may legitimately re-run after a partial failure.

**Event metadata.** The full structure defined in [EVENT_MODEL.md §Event Structure](./EVENT_MODEL.md#event-structure) — Event ID, Event Type, Version, Source, Occurred At / Recorded At, Related Entity, Provenance, Confidence, and the Metadata payload — is stored as first-class, individually queryable fields, not buried inside an opaque blob. Source, Related Entity, and Occurred At in particular back the platform's most common query patterns: a Company's timeline, Collector health monitoring, and the signal-to-listing lead-time metric from [PRODUCT.md §10](./PRODUCT.md#10-success-metrics).

**Source provenance.** An event's Source (its Collector and external origin) is retained permanently and is never summarized away. This is what lets a misbehaving or stale Collector be identified, and its full downstream impact — which Signals, which Intelligence updates, which Opportunities it contributed to — traced without guesswork.

**Confidence propagation.** An event's Confidence is stored with the event and never silently altered by a downstream consumer. When a Signal or an Intelligence update is influenced by lower-confidence events, that reduced confidence propagates into the derived record's own confidence rather than being discarded — every derived aggregate tracks a confidence that is a traceable function of the confidences of the events that produced it, so a User-facing explanation can honestly reflect uncertainty instead of presenting an inference with false precision.

---

## 6. Read Models

Read models exist because the event store is optimized for append-only writes and provenance lookups, not for the filter/sort/paginate query patterns real usage needs. Serving those patterns by replaying event history on every request would violate the scalability principle in [ARCHITECTURE.md §8](./ARCHITECTURE.md#8-scalability) that read paths must stay flat-latency as data volume grows — read models are precomputed, query-optimized projections precisely so that never has to happen. They also isolate blast radius (a broken read model can be dropped and rebuilt with zero risk to canonical data) and allow independent scaling of read traffic from event-ingestion traffic.

### Opportunity Feed

**Purpose:** a browsable, filterable list of currently-live Opportunities, optionally ranked by relevance for the viewing User. **Built from:** the Opportunity Aggregate, the viewing User's Match Aggregate rows, and summary fields from the Company Aggregate for context. **Refresh:** near-real-time, updated incrementally as Opportunity and Match events land — the platform's primary "browse" surface, distinct from the push-based Digest.

### Company Intelligence

**Purpose:** the "Company Radar" surface — a single Company's momentum, funding history, hiring signals, and current Opportunities in one place. **Built from:** the Company Aggregate, the Intelligence Aggregate, and a windowed view of recent Source Events for that Company (for the human-readable activity timeline). **Refresh:** near-real-time as new events land for that Company.

### User Dashboard

**Purpose:** a User's personalized home surface — active Recommendations, saved Opportunities, pending Follow-ups, and recent Application status. **Built from:** the Recommendation, CRM, and Application aggregates, scoped to one User. **Refresh:** near-real-time; this is the platform's highest-traffic read path and must never trigger synchronous Scoring, Decision, or AI work — it only ever reads already-materialized state, per the Design Constraint in [ARCHITECTURE.md §9](./ARCHITECTURE.md#9-design-constraints).

### Daily Digest

**Purpose:** the historical, frozen record of exactly what a User was sent on a given delivery. **Built from:** the set of Recommendations selected at composition time, denormalized at delivery. Unlike every other read model here, this one is deliberately *not* a live query — its entire purpose, per its [Domain Model invariant](./DOMAIN_MODEL.md#daily-digest), is to preserve exactly what was sent, immune to later Opportunity or score updates. **Refresh:** write-once per delivery, read-only afterward.

### Recommendation Feed

**Purpose:** the chronological, filterable, per-User history of every Recommendation ever received — a superset of any single Digest, used for "what was I recommended last month" style queries. **Built from:** the Recommendation Aggregate over time, scoped to one User. **Refresh:** append-oriented and near-real-time as new Recommendations are generated; effectively immutable once a Recommendation reaches a terminal state.

---

## 7. Performance Strategy

**Indexing.** Indexes exist to serve the specific query patterns named in [§6](#6-read-models) — every index should be traceable to a real read model's access pattern, per the principle in [§4](#4-database-schema-principles). Speculative indexing is avoided because Event ingestion is the platform's dominant, ever-growing write load, and every index adds cost to it.

**Partitioning.** The event store is the natural partitioning candidate — by time (queries and replay are frequently time-windowed) and/or by Company (most read models are Company- or Opportunity-scoped) — so that both replay jobs and hot-path queries can prune irrelevant partitions rather than scanning the full historical log as it grows toward the scale target in [ARCHITECTURE.md §8](./ARCHITECTURE.md#8-scalability). The exact partitioning key is deferred to [§9](#9-open-questions), since it depends on the still-open event-store technology decision from [ARCHITECTURE.md §10](./ARCHITECTURE.md#10-open-questions).

**Materialized views.** The read models in [§6](#6-read-models) are conceptually materialized views over the event stream — whether implemented as literal database materialized views, application-maintained projection tables kept in sync by event consumers, or a mix of both is an implementation choice deferred to build time. The architectural commitment is only that they are precomputed and query-optimized, never that any specific database feature is used to achieve it.

**Caching.** Reserved for genuinely hot, coarse-grained, staleness-tolerant reads — a Company summary card reused across many Opportunity Feed entries, for example — distinguished from a read model by being explicitly allowed to be stale within a bounded TTL and safe to evict or recompute on demand, per the Cached classification in [§2](#2-storage-strategy). Caching is never used to paper over a missing read model: if data must always be correct and instantly available, it belongs in a proper read model, not behind a TTL.

**Query optimization.** Driven directly by [ARCHITECTURE.md §8](./ARCHITECTURE.md#8-scalability)'s constraint that per-user computation must stay confined to final ranking. In storage terms: the expensive join (every Opportunity against every User) must never happen at query time. The Match Aggregate exists precisely so "this User's relevant Opportunities" is a narrow, indexed lookup against precomputed rows, never a full cross-product scan.

---

## 8. Evolution Strategy

**Event schema evolution** is fully governed by [EVENT_MODEL.md §Event Versioning](./EVENT_MODEL.md#event-versioning); this document adds only that the persistence layer's job is to store whatever version was declared, verbatim, forever, with an event's declared Version as a first-class, queryable column (§5) so read-time upcasting is always possible without ambiguity.

**Read-model and aggregate schema migrations** have a safety net most CRUD systems lack: because every read model and aggregate table is, by definition, rebuildable from the event log, a migration gone wrong can, in the worst case, be recovered by dropping and replaying rather than requiring a point-in-time restore. That said, migrations should still default to the standard safe sequence — add the new column, backfill it, switch reads over, remove the old column later — because replay is a safety net for emergencies, not a routine operation to lean on for ordinary schema changes.

**Backward compatibility during rollout.** Because the Scoring, Decision, and AI engines are separate deployable packages (per [ARCHITECTURE.md §3](./ARCHITECTURE.md#3-monorepo-structure)) that communicate only through events and persisted state, a schema or version change to one aggregate must never require a synchronized deploy of every consumer. New fields are additive and safely ignorable by consumers that don't yet understand them; breaking changes follow the same expand/contract pattern as any other change — introduce the new shape, migrate consumers, retire the old shape — never a coordinated flag-day cutover.

**Algorithm/rules versioning**, as introduced in [§4](#4-database-schema-principles), means the persistence model must tolerate multiple algorithm or rules versions' outputs coexisting in the same tables at once during a rollout — exactly as it already tolerates multiple Event schema versions coexisting in the event store.

---

## 9. Open Questions

Persistence decisions deliberately deferred to implementation:

1. **Concrete database engine(s).** Whether a single relational database serves both aggregates and the event log, or the event log lives in a separate, log-oriented store, is unresolved — it depends on the still-open event bus technology decision in [ARCHITECTURE.md §10](./ARCHITECTURE.md#10-open-questions).
2. **Exact partitioning/sharding keys** for the event store at scale (§7), deferred until real ingestion volume and query patterns can be observed rather than guessed at.
3. **Blob/binary storage** for Resumes and any other large user-uploaded artifacts — almost certainly not the same store as structured aggregate/event data; the specific choice is deferred.
4. **Match retention policy.** Whether Match history is retained indefinitely or pruned/summarized after a retention window, balancing explainability value against the fact that Match is potentially the platform's highest-volume derived table (User × Opportunity).
5. **Search infrastructure** backing the Opportunity Feed and Recommendation Feed — a dedicated search/index technology versus database-native query capabilities is tied to the Search subsystem's implementation, not decided here.
6. **Confidence-propagation formula.** How contributing events' confidences combine into a Signal's, Intelligence's, or Opportunity's derived confidence (§5) is a Scoring Engine design detail, but the storage layer needs the shape of what it's persisting settled before implementation begins.
7. **Data retention and deletion for compliance.** How a hard-deletion request is reconciled with an otherwise immutable, append-only event store — most likely field-level redaction/tombstoning of personal data within events rather than deleting the events themselves — needs a legal-informed design, cross-referencing the same open item already flagged in [ARCHITECTURE.md §10](./ARCHITECTURE.md#10-open-questions).

---

This document should be updated whenever a storage classification, aggregate boundary, or schema convention changes. It should not be updated to describe an individual table's columns — that belongs in the migrations and schema definitions that implement it.
