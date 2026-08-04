# Web3 Hunter — Event Model

Status: Draft v0.1
Owner: Engineering
Depends on: [docs/PRODUCT.md](./PRODUCT.md), [docs/ARCHITECTURE.md](./ARCHITECTURE.md), [docs/DOMAIN_MODEL.md](./DOMAIN_MODEL.md)

This document defines every category of event in the system, the canonical shape every event follows, and the rules that make the event stream trustworthy enough to build an intelligence platform on top of. Every Collector, service, and subsystem speaks this language — an event that doesn't conform to this document is a bug, regardless of what produced it.

---

## Event Philosophy

Events are the foundation of Web3 Hunter because the product's entire value proposition — [discovering opportunities before they're widely known](./PRODUCT.md#1-vision) — depends on being able to say, precisely, *what we observed, when we observed it, and what we concluded from it.* A system that mutates state in place cannot answer that question honestly once the moment has passed. An event-sourced system can, by construction, because it never throws the moment away.

That said, "event" is not one flat concept in this system. Five distinct terms describe five distinct stages of the same fact's journey from raw noise to actionable intelligence, and conflating them is the single easiest way to corrupt the model:

- **Raw Record** — the unprocessed payload exactly as retrieved from an external source, in that source's native shape: a Greenhouse API response, a scraped HTML fragment, a GitHub webhook body. A Raw Record has no canonical structure and is not trusted as a fact about the world by anything outside the ingestion pipeline that captured it — but it *is* persisted immutably, content-hash-deduplicated, and referenceable, per [ARCHITECTURE.md §3](./ARCHITECTURE.md#3-monorepo-structure)'s `packages/ingestion`. It is pre-canonical, not ephemeral: durability is what makes idempotent reprocessing and full provenance (a Canonical Event citing exactly the Raw Record it was normalized from) possible at all.
- **Event** — a Raw Record after normalization and deduplication: a canonical, typed, immutable fact, published once onto the event bus. This is the unit everything downstream is built on. See [Event Structure](#event-structure).
- **Signal** — an interpretation of what one or more Events mean, per [DOMAIN_MODEL.md](./DOMAIN_MODEL.md#signal). A Signal is a claim about significance, not a claim about what happened — that distinction is why it is a separate concept from an Event rather than a flag on one.
- **Intelligence** — the accumulated, continuously-updated understanding of a Company built from many Signals over time, per [DOMAIN_MODEL.md](./DOMAIN_MODEL.md#intelligence). Intelligence is never a single event; it is a running position, updated as new Signals arrive and old ones decay.
- **Opportunity** — the actionable entity that emerges once a Company's Intelligence crosses a confidence threshold, per [DOMAIN_MODEL.md](./DOMAIN_MODEL.md#opportunity). This is where the system stops describing the world and starts describing something a User can act on.

Each stage is a strictly higher-order abstraction over the one before it, and each transition between stages is itself recorded as an event (see [Event Categories](#event-categories)). Nothing is allowed to skip a stage — a Raw Record cannot become an Opportunity directly, and a Signal cannot be inferred from anything other than a canonical Event. This staging is what keeps every downstream number and recommendation explainable back to a specific, named, immutable fact.

---

## Event Lifecycle

```text
Source (external)
    │
    ▼
Collector
    │  fetches, hands payload to the ingestion pipeline
    ▼
Raw Record            — source-native shape, persisted immutably, content-hash-deduplicated
    │  normalize (collector-supplied, pure function)
    ▼
Normalization          — mapped into a canonical shape for its Event Type
    │
    ▼
Deduplication          — collapses re-polled or multi-sourced duplicates of the same fact
    │
    ▼
Canonical Event         — immutable, typed, published to the event bus
    │  consumed by the Scoring Engine
    ▼
Signal Generation       — the Event is interpreted: does it mean anything, and how much
    │
    ▼
Intelligence Update      — the Company's accumulated understanding is revised
    │
    ▼
Opportunity Evaluation    — does accumulated Intelligence now cross an actionable threshold
    │  consumed by the Decision Engine
    ▼
Decision Engine           — deterministic: recommend? notify? digest? follow-up? prioritize?
    │
    ▼
Recommendation            — the decision is codified as a user-facing, but not yet enriched, entity
    │  consumed by the AI Layer
    ▼
AI Enrichment              — explanation, summary, and outreach content are generated for it
    │
    ▼
User Action                 — delivered (digest/alert/dashboard), then interacted with
```

Every arrow in this diagram is a publish/subscribe boundary, not a function call — see [ARCHITECTURE.md §3](./ARCHITECTURE.md#3-monorepo-structure) on why pipeline order is an event-consumption sequence, not an import chain. Each stage publishes the event(s) described in [Event Categories](#event-categories) below, and the next stage's only input is what was published, never a direct read of an earlier stage's internals.

Two properties of this lifecycle are worth stating explicitly because they are easy to get wrong in implementation:

- **A Raw Record never appears on the event bus, even though it is durably persisted.** Persisted and canonical are different properties: a Raw Record is stored immutably so it can be reprocessed idempotently and cited as provenance, but it is never itself published as an Event, and nothing downstream of the ingestion pipeline reads it directly. The bus only ever sees Canonical Events.
- **A Recommendation exists, unenriched, before the AI Layer runs.** The Decision Engine's determination is what makes a Recommendation valid; AI Enrichment adds explanatory content to something that already exists and was already decided, per [ARCHITECTURE.md §9](./ARCHITECTURE.md#9-design-constraints). An AI outage delays *how well-explained* a Recommendation is, never *whether* it exists.

---

## Event Categories

Every Event Type belongs to exactly one category. Categories group events by who produces them and what they're about — not by which subsystem happens to consume them, since (per the [Event-Driven Architecture](./ARCHITECTURE.md#4-event-driven-architecture) principle) any event may have consumers its producer never anticipated.

### Source Events (produced by Collectors)

Canonical, normalized facts about the outside world. These are the only events allowed to assert something happened in reality.

- **Company Events** — `CompanyDiscovered`, `CompanyUpdated`, `CompanyMerged` (identity resolution collapsing a duplicate record)
- **Funding Events** — `CompanyFunded`, `InvestmentDisclosed`
- **Hiring Events** — `JobPosted`, `JobUpdated`, `JobClosed`
- **Engineering Events** — `EngineeringBlogPublished`, `TechnicalDocumentPublished`
- **Repository Events** — `RepositoryCreated`, `RepositoryActivitySpiked`, `ContributorJoined`
- **Release Events** — `ProtocolLaunched`, `MainnetDeployed`, `VersionReleased`
- **Grant Events** — `GrantProgramAnnounced`, `GrantAwarded`
- **Founder Events** — `FounderActivityDetected`, `FounderPostPublished`

### Intelligence Events (produced by the Scoring Engine)

Not part of the original source-category list, but necessary to name the internal stages the [Event Lifecycle](#event-lifecycle) requires — these are the events that record the Scoring Engine's own reasoning, and they are what every Signal, Intelligence, and Opportunity invariant in [DOMAIN_MODEL.md](./DOMAIN_MODEL.md) actually cashes out as.

- `HiringSignalDetected`, `SignalDecayed`
- `IntelligenceUpdated`
- `OpportunityDetected`, `OpportunityScored`, `OpportunityUpdated`, `OpportunityArchived`

### Decision Events (produced by the Decision Engine)

Also not in the original example list, for the same reason as Intelligence Events — the Decision Engine's determinations must be individually named, immutable facts, not side effects buried inside a Recommendation.

- `OpportunityRecommended`
- `NotificationTriggered`
- `DigestEntrySelected`
- `FollowUpScheduled`
- `OutreachPrioritized`

### Recommendation Events (produced by the AI Layer and the Recommendation's own lifecycle)

- `AIRecommendationGenerated` — enrichment content produced for an already-existing `OpportunityRecommended` decision (see the AI constraint in [Event Rules](#event-rules))
- `RecommendationDelivered`, `RecommendationActioned` (User marked interested / not relevant / saved), `RecommendationExpired`

### Application Events (user-originated, via the Backend/CRM)

- `ApplicationSubmitted`, `ApplicationStatusUpdated`

### User Events (user-originated, via the Backend)

- `UserRegistered`, `UserProfileUpdated`, `UserPreferencesUpdated`, `MatchFeedbackRecorded` (the Calibration feedback described in [PRODUCT.md §6](./PRODUCT.md#6-user-journey))

### Notification Events (produced by the Notifications subsystem)

Delivery-mechanics outcomes, distinct from the Decision Engine's `NotificationTriggered` — the Decision Engine decides *whether* to notify; these events record *what happened when it tried*.

- `DailyDigestComposed`, `DailyDigestDelivered`
- `NotificationDelivered`, `NotificationOpened`, `NotificationDeliveryFailed`

---

## Event Structure

Every Canonical Event, regardless of category, shares the same conceptual shape. This section describes the concepts that shape must express — not a schema, table, or interface.

- **Event ID.** A globally unique, immutable identifier assigned at the moment an Event is created. Every downstream reference — a Signal citing its source Events, a Recommendation's explanation chain — points to an Event ID, never to a description of the event. It is also the basis for idempotent re-processing: the same Event ID must never be created twice.
- **Event Type.** The canonical name of the fact (e.g., `CompanyFunded`), drawn from the closed, versioned vocabulary defined in [Event Categories](#event-categories). No subsystem may emit an ad hoc or free-form Event Type.
- **Version.** The schema version of this Event Type's Metadata shape, so any consumer knows how to interpret the payload it received. See [Event Versioning](#event-versioning).
- **Source.** For a Source Event, which Collector produced it and the original external source it came from (e.g., "GitHub collector, org `acme-labs`"). For every other category, the identifier of the producing subsystem instead (the Scoring Engine, the Decision Engine, the AI Layer, or the Backend) — only Source Events are Collector-produced, per [DOMAIN_MODEL.md §Collector](./DOMAIN_MODEL.md#collector). Either way, this is the provenance root every audit and explainability trail starts from.
- **Occurred At / Recorded At.** Two distinct timestamps: when the fact actually happened in the world, and when the platform observed and recorded it. The gap between them is itself a meaningful, tracked quantity — it's the raw material behind the "signal-to-listing lead time" metric in [PRODUCT.md §10](./PRODUCT.md#10-success-metrics).
- **Related Entity.** An explicit reference to the domain entity (or entities) the event is *about* — typically a Company, sometimes a Contact. Never implicit or inferable only from Metadata contents.
- **Provenance.** For derived events only (Intelligence, Decision, Recommendation categories): explicit references to the upstream Event(s), Signal(s), or Decision that caused this event to be produced. A Source Event has empty provenance — it is the origin. Every derived event must have non-empty provenance; this is the field that makes [Domain Rule #1](./DOMAIN_MODEL.md#domain-rules) ("every Opportunity must be traceable...") mechanically enforceable rather than aspirational.
- **Confidence.** A normalized indicator of how certain the platform is that this specific event's content is accurate and current — most relevant for inferred facts (e.g., a Contact's current role, a Tech Stack entry). Confidence describes trust in the *event itself*; it is distinct from an Opportunity's hiring-likelihood score, which describes business significance, not factual certainty.
- **Metadata.** The normalized, Event-Type-specific payload — the actual content of the fact, structured according to the shape its declared Version specifies.

---

## Event Rules

These invariants hold for every event, in every category, without exception:

1. **Events are immutable.** Once published, an event's fields never change.
2. **Events are append-only.** Nothing is ever deleted from the event log. A correction is a new event that supersedes, not overwrites.
3. **Collectors never modify events.** A Collector's only capability is producing new Source Events from its Raw Records; it has no access path to edit or remove any event, including its own past ones.
4. **Signals are derived from events, never invented.** A Signal with no cited Event provenance is invalid and must not be persisted.
5. **AI never creates events that assert a new fact about the world.** The only event the AI Layer may publish, `AIRecommendationGenerated`, records that enrichment content was generated for an `OpportunityRecommended` decision that already existed — it never originates a fact, a Signal, an Intelligence update, or a Decision itself. This is the event-level enforcement of the "AI never becomes the source of truth" rule in [ARCHITECTURE.md §9](./ARCHITECTURE.md#9-design-constraints).
6. **Users never edit events.** User actions (`ApplicationSubmitted`, `MatchFeedbackRecorded`, etc.) create new events describing what the User did; they never retroactively alter a Source, Intelligence, or Decision event.
7. **Every derived event must carry provenance.** Per [Event Structure](#event-structure), an Intelligence, Decision, or Recommendation-category event with empty provenance is malformed and must be rejected, not silently accepted.
8. **Duplicate facts are collapsed before they become events.** Deduplication happens upstream of the event bus (see [Event Lifecycle](#event-lifecycle)); the canonical event log contains no two events representing the same real-world fact.
9. **An event's Metadata must conform to its declared Version.** A consumer that receives an event whose Metadata fails to validate against its declared Version must reject or quarantine it — never silently coerce or guess.
10. **The event log is the durable source of truth.** Every read model or projection (an Opportunity's current state, a Company's profile) must be exactly reproducible by replaying the event log from the beginning.

---

## Event Versioning

Event schemas evolve continuously as new sources are added and existing ones mature. The event log's append-only nature means versioning has to be handled without ever rewriting history:

- **Versioning is per Event Type, not global.** `CompanyFunded` and `JobPosted` evolve independently; there is no single platform-wide "event schema version."
- **Additive changes do not require a new version.** Adding a new optional field to an Event Type's Metadata is backward compatible — existing consumers that don't know about the field simply ignore it.
- **Breaking changes require a new version.** Renaming, removing, retyping, or changing the meaning of an existing field requires incrementing the Event Type's version. Both the old and new versions may coexist on the bus indefinitely; old events keep their original version forever.
- **Consumers declare which versions they understand.** A consumer encountering an event version newer than it knows how to handle degrades safely — it skips or queues the event for later reprocessing, it does not crash or silently misinterpret the payload.
- **Historical events are never rewritten to match a newer schema.** If a consumer needs a uniform shape across versions, that translation happens at read-time via an explicit, versioned adapter — the stored event is untouched, preserving [Event Rule #1](#event-rules).
- **Deprecating an Event Type** means new instances stop being emitted; every historical instance remains exactly as it was published, forever queryable.

---

## Future Extensions

The event model is designed so that growth is additive, not disruptive:

- **New Collectors require no changes to existing systems.** A new Collector either normalizes into an existing Event Type or introduces a new one within an existing category — no existing Collector, engine, or consumer needs to change to accommodate it.
- **New Event Categories can be added to the taxonomy.** For example, a future on-chain-activity category (treasury health, governance participation — see [PRODUCT.md's Future Vision](./PRODUCT.md#11-future-vision)) extends [Event Categories](#event-categories) without touching any category already defined here.
- **Subscription is by Event Type, so new types have zero blast radius.** Consumers subscribe explicitly to what they care about; publishing a new Event Type affects no consumer that hasn't opted in.
- **New derived-event producers can be added at any stage.** A future engine (for example, a warm-intro graph service, per [PRODUCT.md's Future Vision](./PRODUCT.md#11-future-vision)) can consume existing events and publish its own new event category — `WarmIntroDetected`, say — without any change to Collectors, the Scoring Engine, or the Decision Engine. The layering defined in the [Event Lifecycle](#event-lifecycle) is precisely what makes this possible: each stage only ever depends on what earlier stages published, never on their implementation.

---

This document should be updated whenever an Event Type is added, deprecated, or has a breaking version change. It should not be updated to describe how an event is stored or transported — that belongs in the database and infrastructure design that implements it.
