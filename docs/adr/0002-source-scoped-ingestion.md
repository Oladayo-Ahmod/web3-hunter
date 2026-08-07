# ADR 0002: Scope Raw Record ingestion and reconciliation by source identifier

**Status:** Accepted
**Date:** 2026-08-06
**Context:** Investigation triggered by ADR 0001 (fetch-only collector concurrency)

## Context

ADR 0001 documented a correctness bug found while investigating collector
concurrency: `packages/ingestion`'s `runIngestionPipeline` and
`reconcileMissingRecords` scope their queries by `collectorId` alone.
For any Collector tracking more than one company — which the live
Greenhouse Collector already does — this causes real, confirmed
cross-company misattribution: one company's Raw Records can be
normalized under another company's identity, and one company's
still-open roles can be reconciled as closed under another company's
identity. Confirmed both by tracing every `collectorId`-only query and
by empirical reproduction against the real, unmodified, fully
sequential code (see the investigation record — not reproduced here).

Three fix approaches were compared: adding `company_id` directly to
`raw_record`; adding `source_identifier` to `raw_record` and scoping by
it; and deriving a source identifier from the stored payload at query
time with no schema change. A fourth option — atomic company-level
grouping across all of a company's sources — was identified but
rejected as disproportionate complexity for a scenario (one company,
multiple source identifiers under one Collector) that doesn't exist in
current data.

## Decision

Add `source_identifier` to `raw_record`. Scope every `raw_record` query
in `packages/ingestion` that previously used `collectorId` alone by
`(collector_id, source_identifier)` instead.

Chosen over storing `company_id` directly because it's immune to a
concrete failure mode `company_id`-scoping has: a company with multiple
source identifiers under one Collector (e.g. two regional boards) would
have one board's still-open roles incorrectly closed whenever a run
only fetches the other board — the same bug class this ADR exists to
fix, reintroduced at the company level unless the caller separately
guarantees every company's sources are always fetched atomically
together. Scoping by `source_identifier` is naturally correct here,
since each identifier is scoped to exactly what one `fetchRecords` call
covers.

Chosen over payload-derived extraction because the caller already has
`sourceIdentifier` in hand at the exact call site (it's the literal
parameter passed to `fetchRecords`) — no lookup, join, or payload
parsing is required. Payload-derived extraction was rejected as the
*ongoing* mechanism specifically because its reliability depends on
URL-parsing heuristics that don't hold for every real-world ATS
configuration (custom-domain career pages), and because it pushes
correctness-critical logic into each collector's own judgment rather
than a type-enforced API boundary every caller must satisfy — the same
shape of mistake that produced this bug.

`sourceIdentifier` is a **required** parameter on every affected
function, not optional — the goal is that omitting it is a compile-time
error, not a silent reversion to the old, unscoped behavior.

## Consequences

- `packages/ingestion` gains no new cross-package dependency. It
  filters by an additional opaque scoping value, the same shape of
  dependency it already has on `collectorId` — it still has no concept
  of what a "company" is.
- No join or extra query is introduced — `sourceIdentifier` is already
  known by the caller at the point it calls `storeRawRecord`.
- Fixes ingestion misattribution and reconciliation false-closure going
  forward. Does **not** repair already-corrupted historical data — see
  the assumptions below.

## Assumptions documented at approval time

- **Historical data is not repaired by this change.** Already-published
  `event`/`signal` rows with incorrect `relatedEntityId` remain
  incorrect. This ADR fixes ingestion going forward only; retroactive
  repair is a separate, still-open problem with no designed solution
  (the event/signal model has no compensating-event concept today).
- **Multi-board-per-company continuity is knowingly not handled.** If a
  company ever runs two source identifiers under the same Collector, a
  posting moving between them reads as one closing and a new one
  appearing, not as a move. Accepted because no company in current data
  does this.
- **Cross-source content-hash collision safety rests on an external
  assumption**, not an enforced invariant: that each ATS's own job IDs
  are unique within its own platform, not merely within one company's
  board. True today for Greenhouse (globally-sequenced numeric IDs),
  Lever and Ashby (UUIDs); not something this schema itself guarantees.
