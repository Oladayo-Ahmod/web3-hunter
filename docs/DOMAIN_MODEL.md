# Web3 Hunter — Domain Model

Status: Draft v0.1
Owner: Engineering
Depends on: [docs/PRODUCT.md](./PRODUCT.md), [docs/ARCHITECTURE.md](./ARCHITECTURE.md)

This document defines the business language of Web3 Hunter. It exists so that every engineer, regardless of which subsystem they're working in, uses the same words to mean the same things. It intentionally says nothing about database tables, schemas, or code — those are implementations of the concepts defined here, and should be traceable back to this document, not the other way around.

---

## Core Entities

### User

**Purpose:** Represents an individual engineer using the platform — the account and identity behind all personalization, preferences, and actions.

**Responsibilities:** Owns authentication/identity and notification/cadence preferences. Is the root that a User Profile, Matches, Recommendations, Applications, and Follow-ups all ultimately belong to.

**Lifecycle:** Registered → Onboarding (profile incomplete) → Active (profile calibrated, receiving Matches and Recommendations) → Dormant (inactive, digests paused) → Deactivated (terminal; data retained per retention policy, no longer processed). A User moves freely between Active and Dormant.

**Relationships:** Has exactly one User Profile. May have zero or one Resume. Has many Matches, Recommendations, Applications, and Follow-ups.

**Invariants:** A User cannot receive a Recommendation without a User Profile — there is nothing to match against. A User's notification cadence preference is always respected by the Decision Engine; no Recommendation delivery bypasses it.

### User Profile

**Purpose:** The domain data used for matching — distinct from the User's account/identity concerns.

**Responsibilities:** Captures Skills, chain/language experience, GitHub activity, company-stage and compensation preferences, and deal-breakers — every input the Match computation reads.

**Lifecycle:** Created at onboarding (may start minimal) → Calibrated (refined through user feedback on early Matches, per the [Calibration step](./PRODUCT.md#6-user-journey) in the product journey) → Continuously Updated. Never "complete" — always open to revision.

**Relationships:** Belongs to exactly one User. References zero or many Skills. Informs every Match computed for that User.

**Invariants:** The User Profile's Skill list is the canonical input to matching — a Resume, if present, never overrides it. Stated deal-breaker preferences (e.g., "no pre-seed companies") are hard filters the Decision Engine must respect, not soft signals a score can outweigh.

### Resume

**Purpose:** An optional, supplementary artifact a User may attach for their own reference or to support outreach — never the platform's primary input, per [Product Principle](./PRODUCT.md#9-product-principles).

**Responsibilities:** Provides auxiliary context only — for example, an attachment for a Contact who explicitly requests one during outreach.

**Lifecycle:** Uploaded (optional, any time) → Stored → Superseded (a newer version replaces it) or Removed.

**Relationships:** Belongs to zero or one User at a time.

**Invariants:** A Resume is never authoritative for Skills, matching, or scoring — the User Profile is. The absence of a Resume never degrades a User's Matches or Recommendations.

### Company

**Purpose:** Represents a real-world organization in the Web3 ecosystem — the subject that produces Events and accumulates Intelligence.

**Responsibilities:** Holds canonical identity (resolved across sources) and public profile data (funding stage, size, focus area). Aggregates its Tech Stack, Contacts, and Intelligence.

**Lifecycle:** Discovered (first Event referencing it observed) → Tracked (actively monitored by Collectors) → Dormant (no recent Events) → Merged (identity resolved into another Company record, if a duplicate is later discovered).

**Relationships:** Produces many Events. Accumulates one continuously-updated Intelligence profile. Has zero or many Contacts. Has zero or many Opportunities over time. Has a Tech Stack.

**Invariants:** A Company can exist with zero Opportunities — being tracked is not the same as being an active opportunity. Once a Company's identity is resolved, it is canonical; Events are never left pointing at a since-merged duplicate.

### Contact

**Purpose:** A specific person at a Company relevant to a hiring conversation — a founder, engineering manager, or hiring lead.

**Responsibilities:** Holds publicly-derived identity and role information used to direct outreach.

**Lifecycle:** Identified (from a public source) → Verified (confidence increases as corroborating Signals accumulate) → Stale (no longer confirmed current — role or company affiliation may have changed).

**Relationships:** Belongs to exactly one Company at a time (see [Future Extension Points](#future-extension-points) for affiliation history). May be referenced by many Recommendations as the suggested outreach target.

**Invariants:** A Contact is never a User — it is external, public-data-derived information about a person, not a platform account. A Contact's affiliation must be re-verifiable back to the Signals and Events that established it — explainability applies to Contacts, not just to scores.

### Event

**Purpose:** An immutable record of a single fact observed from the outside world, as defined in [ARCHITECTURE.md §4](./ARCHITECTURE.md#4-event-driven-architecture).

**Responsibilities:** Captures exactly one fact — a funding round, a job posting, a repository creation — with its source, timestamp, and payload.

**Lifecycle:** Emitted (by a Collector) → Persisted → immutable thereafter. An Event is never edited; a correction is a new Event.

**Relationships:** Produced by exactly one Collector. Concerns exactly one Company (or, rarely, is ecosystem-wide and unassociated). May contribute to zero, one, or many Signals.

**Invariants:** Every Event is immutable once persisted. Every Event carries enough provenance — source, Collector, timestamp — to be independently audited.

### Signal

**Purpose:** An interpreted, weighted piece of evidence about what one or more Events mean for a Company's hiring likelihood or momentum.

**Responsibilities:** Bridges raw fact (Event) and aggregated understanding (Intelligence) by assigning meaning and weight to observed activity.

**Lifecycle:** Derived (computed from one or more Events by the Scoring Engine) → Contributed (folded into the Company's Intelligence) → Aged (its weight decays over time unless reinforced by new corroborating Events).

**Relationships:** Derived from one or many Events. Contributes to exactly one Company's Intelligence.

**Invariants:** A Signal always references the Event(s) it was derived from — there is no such thing as an unexplained Signal. A Signal's weight must decay over time in the absence of reinforcement, so stale activity does not indefinitely inflate a Company's Intelligence.

### Opportunity

**Purpose:** The platform's central, actionable entity, as established in [ARCHITECTURE.md §1.1](./ARCHITECTURE.md#11-companies-produce-events-events-produce-opportunities-opportunities-are-what-users-act-on) — the specific thing a User can ultimately act on.

**Responsibilities:** Represents a distinct hiring possibility at a Company — which may or may not correspond to a single publicly posted role — carrying its own hiring-likelihood score and supporting evidence.

**Lifecycle:** Detected (a Company's Intelligence crosses a confidence threshold) → Scored/Updated (as new Signals arrive) → Matched (compared against User Profiles) → Prioritized (evaluated by the Decision Engine) → Archived (no longer live — role filled, company stopped hiring, or signal decayed below threshold).

**Relationships:** Derived from one Company's Intelligence (and transitively, its Signals and Events). Compared against many User Profiles, producing many Matches. May result in many Recommendations — one per User it is surfaced to.

**Invariants:** Every Opportunity must be traceable to the Intelligence, Signals, and Events that produced it — an Opportunity with no evidentiary chain must not exist. An Opportunity's existence and score are independent of any single User; it is not created "for" a user, only later matched to one.

### Recommendation

**Purpose:** The user-facing, decided, AI-enriched surfacing of a Match — what a User actually sees and can act on.

**Responsibilities:** Carries the Decision Engine's determination that a Match was worth surfacing, plus the AI Layer's explanation, summary, and any outreach draft.

**Lifecycle:** Generated (Decision Engine prioritizes a Match; AI Layer enriches it) → Delivered (via Daily Digest, alert, or dashboard) → Actioned (User responds: interested, not relevant, saved) or Expired (superseded by a fresher Recommendation for the same Opportunity, or the Opportunity is archived).

**Relationships:** Wraps exactly one Match (and transitively, one User and one Opportunity). May be included in one Daily Digest. May lead to an Application or a Follow-up.

**Invariants:** A Recommendation never exists without a backing Decision Engine determination — AI content alone is never sufficient to produce one, per [ARCHITECTURE.md §9](./ARCHITECTURE.md#9-design-constraints). A Recommendation's explanation must always be reconstructable from its underlying Match, Opportunity, and Signals.

### Match

**Purpose:** The computed fit assessment between a User Profile and an Opportunity.

**Responsibilities:** Holds the relevance score and the specific reasoning behind it — matched Skills, matched Tech Stack, matched preferences — richer than a bare number (see [Match ≠ Score](#ubiquitous-language)).

**Lifecycle:** Computed (whenever a new or updated Opportunity is compared against a User Profile, or vice versa) → Recomputed (as either side changes) → Superseded (an older Match for the same User/Opportunity pair is replaced, never edited in place).

**Relationships:** Connects exactly one User Profile to exactly one Opportunity. May be the basis for zero or one active Recommendation at a time.

**Invariants:** A Match always exists between a User Profile and an Opportunity specifically — never directly between a User and a Company (see [Domain Rules](#domain-rules)). A Match below the platform's relevance floor must never be escalated into a Recommendation, regardless of any other factor.

### Application

**Purpose:** Records that a User has formally submitted interest in an Opportunity.

**Responsibilities:** Marks the point at which a Recommendation — or a User's own initiative — turned into a real-world action outside the platform.

**Lifecycle:** Submitted (User marks an Opportunity as applied-to, e.g., via `ApplicationSubmitted`) → Status Updated (User self-reports progress: interviewing, offer, rejected, withdrawn) → Closed.

**Relationships:** Belongs to exactly one User. References exactly one Opportunity. May reference the Recommendation that led to it.

**Invariants:** An Application is user-reported, not verified by the platform — it is CRM state, not a hiring-pipeline record, per [Non-Goals](./PRODUCT.md#8-non-goals). An Application never blocks or alters an Opportunity's score or its visibility to other Users.

### Follow-up

**Purpose:** A scheduled future touchpoint for a User regarding an Opportunity or Company, produced by the Decision Engine's `FollowUpScheduled` decision.

**Responsibilities:** Preserves relationship continuity — for example, "revisit after their Series A closes" — so that timing works in the user's favor, per [Product Principle](./PRODUCT.md#9-product-principles).

**Lifecycle:** Scheduled (Decision Engine determines a future condition or date) → Triggered (the condition is met — e.g., a new Signal arrives) → Surfaced (CRM presents it to the User) → Resolved (User acts, dismisses, or reschedules).

**Relationships:** Belongs to exactly one User. References exactly one Opportunity or Company. May be triggered by a future Event or Signal.

**Invariants:** A Follow-up's trigger condition is always explicit and evaluable by the Decision Engine — never a vague "someday." The CRM stores and surfaces a Follow-up but never decides independently when one is warranted, per [ARCHITECTURE.md §2](./ARCHITECTURE.md#2-high-level-system-overview).

### Daily Digest

**Purpose:** The batched, cadence-respecting delivery of a User's new Recommendations.

**Responsibilities:** Composes the set of Recommendations the Decision Engine selected for inclusion (`DigestEntrySelected`) into a single, coherent delivery.

**Lifecycle:** Composed (at the User's configured cadence) → Delivered → Read/Unread (tracked for engagement) → Archived (immutable historical record).

**Relationships:** Belongs to exactly one User. Contains zero or many Recommendations for a given delivery.

**Invariants:** A Daily Digest is a snapshot — once delivered, its contents do not change even if underlying Opportunities or scores are later updated. An empty Digest is a valid, expected outcome; the platform must never pad a Digest to appear active, per the [Product Principle](./PRODUCT.md#9-product-principles) of prioritizing quality over quantity.

### Collector

**Purpose:** The persistent identity and configuration of a single source-specific ingestion adapter, as defined in [ARCHITECTURE.md §2](./ARCHITECTURE.md#2-high-level-system-overview).

**Responsibilities:** Represents "which source, checked how often, in what health state" — the provenance root for every Event it produces.

**Lifecycle:** Configured → Active (running on schedule) → Degraded (elevated failure rate or staleness) → Disabled (manually or automatically stopped).

**Relationships:** Produces many Events. Belongs to exactly one external source.

**Invariants:** Every Source Event must reference the Collector that produced it — there is no anonymous Source Event. This applies to the Source Event category specifically, not to every Event in the system: Decision, AI, Application, and User Events are produced by the Decision Engine, the AI Layer, and the Backend respectively, none of which are Collectors — see [EVENT_MODEL.md §Event Structure](./EVENT_MODEL.md#event-structure) for how a non-Collector-originated Event's provenance is recorded instead. A Collector never has direct knowledge of Signals, Intelligence, or Opportunities, per [ARCHITECTURE.md §9](./ARCHITECTURE.md#9-design-constraints).

### Intelligence

**Purpose:** The continuously-updated, company-level understanding built from accumulated Signals over time — the "Company Radar" referenced in [ARCHITECTURE.md §2](./ARCHITECTURE.md#2-high-level-system-overview).

**Responsibilities:** Aggregates Signals into a running assessment of a Company's momentum and hiring likelihood, independent of any single User.

**Lifecycle:** Initialized (first Signal for a Company) → Continuously Updated (as new Signals are contributed and old ones decay). Never deleted — only superseded or extended.

**Relationships:** Belongs to exactly one Company. Aggregates many Signals. When it crosses a confidence threshold, gives rise to one or more Opportunities.

**Invariants:** Intelligence is never itself shown to or acted on directly by a User — it is the substrate Opportunities are derived from, not a user-facing entity. Intelligence is additive and historical; it is never deleted, only extended, so trend over time remains reconstructable.

### Skill

**Purpose:** A defined competency or technical domain relevant to Web3 engineering — e.g., "Solidity," "Zero-Knowledge Proofs," "Rust."

**Responsibilities:** Reference data used on a User Profile (what a User has) and in a Match computation (compared against an Opportunity's requirements and a Company's Tech Stack).

**Lifecycle:** Defined (added to the platform's taxonomy) → Used (referenced by Profiles and Opportunities) → Deprecated (rare — merged into a newer or more precise Skill as the taxonomy evolves).

**Relationships:** Referenced by many User Profiles. Referenced by many Opportunities as required or preferred Skills.

**Invariants:** A Skill is a taxonomy concept, not free text — matching depends on Skills being a shared, consistent vocabulary across Users and Opportunities.

### Tech Stack

**Purpose:** The set of technologies a Company or Opportunity actually uses — e.g., "Solidity + Foundry + The Graph."

**Responsibilities:** Provides the Company/Opportunity-side counterpart to a User's Skills, enabling the Match computation to reason about technical fit specifically, distinct from general relevance.

**Lifecycle:** Observed (inferred from Events — e.g., repository language data, job posting requirements) → Refined (as more corroborating Events arrive) → Updated (as a Company's technical choices evolve).

**Relationships:** Belongs to a Company and, more specifically, to an Opportunity, where it can differ from the Company's general stack (e.g., one team using a different stack than the rest of the org).

**Invariants:** A Tech Stack is inferred from evidence (Events and Signals), never self-declared by the Company, and must remain traceable to what produced it. Tech Stack is not Skill: one describes what a Company builds with, the other describes what a User knows — a Match compares them, it does not conflate them.

---

## Entity Relationships

The core lifecycle of the platform, from raw fact to user action:

```text
Company
  │  produces
  ▼
Event  ──────────────────────────── (Collector: provenance root for every Event)
  │  interpreted into
  ▼
Signal
  │  aggregated into
  ▼
Intelligence  ─────────────────────── (belongs to exactly one Company; never user-facing)
  │  crosses a confidence threshold, gives rise to
  ▼
Opportunity  ───────────────────────── (traceable back through Intelligence → Signals → Events)
  │  compared against a User Profile
  ▼
Match  ─────────────────────────────── (User Profile × Opportunity; carries Skill/Tech Stack reasoning)
  │  evaluated and prioritized by the Decision Engine
  ▼
Recommendation  ────────────────────── (AI-enriched; may reference a Contact for outreach)
  │  delivered via
  ▼
Daily Digest (or a direct alert)
  │  User acts
  ▼
Application  ──or──  Follow-up
```

Supporting relationships that sit alongside this main chain:

- **User → User Profile → Resume.** A User has exactly one User Profile (the canonical matching input) and optionally one Resume (supplementary only).
- **Company → Contact.** A Company has zero or many Contacts, who may be referenced by a Recommendation as an outreach target.
- **Company → Tech Stack.** A Company's Tech Stack is inferred from its Events and informs Match reasoning alongside a User's Skills.
- **Follow-up and Daily Digest both originate from the Decision Engine**, not from AI or from the entity they attach to — a Follow-up is scheduled, and a Digest entry is selected, by the same deterministic decision logic that prioritizes Opportunities in the first place.

---

## Ubiquitous Language

These distinctions are precise and intentional. Using these terms interchangeably in code, discussion, or documentation is a bug in communication, not a stylistic choice.

- **Event ≠ Signal.** An Event is a raw, immutable fact from a source. A Signal is an interpretation of what that fact (or a cluster of facts) means.
- **Signal ≠ Intelligence.** A Signal is one piece of evidence. Intelligence is the accumulated, continuously-updated understanding built from many Signals over time.
- **Intelligence ≠ Opportunity.** Intelligence is company-level and not itself actionable. An Opportunity is the specific, actionable unit that emerges once Intelligence crosses a confidence threshold.
- **Company ≠ Opportunity.** A Company is an organization. An Opportunity is a derived, scored entity representing a specific hiring possibility at that company. A Company may have zero, one, or many concurrent Opportunities.
- **Match ≠ Score.** A Score is a single numeric output. A Match is the full fit assessment — the score plus the matched Skills, Tech Stack, and reasoning behind it.
- **Match ≠ Recommendation.** A Match is a computed fact: this User fits this Opportunity to some degree. A Recommendation is a decision to surface that Match to the User, enriched with an AI-generated explanation.
- **Recommendation ≠ Opportunity.** An Opportunity can exist and be scored without ever becoming a Recommendation, if it isn't prioritized for any User. A Recommendation is the user-facing, decided-and-enriched instance of an Opportunity, delivered through a Match.
- **Application ≠ Follow-up.** An Application is a discrete, user-reported action indicating interest was formally submitted. A Follow-up is a scheduled future touchpoint, which may exist with or without an Application ever being made.
- **Collector ≠ Event.** A Collector is the persistent source-adapter identity. An Event is one fact instance it produced.
- **User ≠ User Profile.** A User is account, identity, and preferences. A User Profile is the domain data — Skills, experience, preferences — used specifically for matching.
- **Skill ≠ Tech Stack.** A Skill belongs to a User (a competency they have). A Tech Stack belongs to a Company or Opportunity (the technologies used there). Matching compares the two; it never conflates them.

---

## Domain Rules

Business rules that must always remain true, independent of any specific implementation:

1. Every Opportunity must be traceable to the Intelligence, Signal(s), and Event(s) that produced it. An Opportunity with no evidentiary chain is invalid and must not exist.
2. Every Recommendation must reference the Decision Engine determination that authorized it. AI-generated content is never, by itself, sufficient grounds to surface something to a User.
3. A Company may exist with zero Opportunities. Being tracked is not the same as being an active opportunity.
4. A Match is computed only between a User Profile and an Opportunity — never directly between a User and a Company.
5. Resume data, when present, never overrides explicitly captured Skill or User Profile data; it is supplementary context only.
6. A Contact belongs to exactly one Company at a time. Historical affiliation is not a first-class concern in v1 (see [Future Extension Points](#future-extension-points)).
7. A Follow-up always belongs to exactly one User and references exactly one Opportunity or Company, with an explicit, evaluable trigger condition.
8. Every Event is immutable once recorded. A correction is a new Event, never an edit to an existing one.
9. A Daily Digest is a snapshot at the time of delivery. Its contents do not retroactively change if the underlying Opportunities or scores are later updated.
10. Intelligence about a Company is never deleted — only extended or superseded — so historical trend always remains reconstructable.
11. A Match below the platform's relevance floor must never be escalated into a Recommendation, regardless of any other factor (e.g., a company's overall popularity or funding size cannot buy visibility it hasn't earned for a specific User).
12. Skills and Tech Stack entries are taxonomy concepts, not free text — every Match's reasoning must be expressible in terms of the shared vocabulary, not ad hoc strings.

---

## Future Extension Points

Places where the model is intentionally left open rather than over-specified now:

- **Contact affiliation history.** Tracking a Contact's movement between companies over time (currently: a Contact belongs to exactly one Company at a time, with no history).
- **Team/organization accounts.** Companies viewing their own visibility and signal strength to engineers, per the [Future Vision](./PRODUCT.md#11-future-vision) — would introduce a company-side actor distinct from User and Contact.
- **Warm-intro graph.** Modeling relationships between Users (or between a User and a Contact) to support "who in your network already knows this company," per the [Future Vision](./PRODUCT.md#11-future-vision).
- **Resume versioning.** Currently a User has at most one current Resume; multiple versions or role-specific tailoring is a plausible later extension.
- **Skill proficiency and verification.** Skills are currently a flat taxonomy; proficiency levels, or verification derived from GitHub/on-chain activity, are natural extensions that would enrich Match reasoning without changing the core Skill concept.
- **Tech Stack evolution over time.** Currently represented as current-state; a historical view (how a Company's stack has changed) would strengthen Intelligence and long-term Company tracking.
- **Opportunity decay/expiry modeling.** The exact rules for when an Opportunity transitions to Archived (time-based decay vs. explicit negative Signals vs. both) are intentionally left open for the Scoring Engine's design, not fixed here.
- **Grouped Opportunities.** Multiple concurrent Opportunities at the same Company (e.g., a hiring wave following a funding round) may eventually warrant an explicit grouping concept above the individual Opportunity, rather than being treated as unrelated records.

---

This document should be updated whenever a core business concept changes meaning, gains a new relationship, or a new entity is introduced. It should not be updated to describe field-level or storage detail — that belongs in the database design that implements it.
