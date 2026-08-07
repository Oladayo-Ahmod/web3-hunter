# ADR 0001: Fetch-only concurrency in the Collector orchestrator

**Status:** Accepted
**Date:** 2026-08-06
**Context:** Milestone 11 — Company Metadata & Curated Directory at Scale

## Context

Milestone 11's Definition of Ready called for bounded concurrency in
`apps/web/lib/collectors/run-collector.ts`'s per-company loop, to keep
collector runs comfortably within a reasonable execution window as the
curated company directory grows toward hundreds of companies. The
original design ran each company's entire sequence — resolve, fetch,
persist, ingest, reconcile — inside one `Promise.all`-batched
concurrent unit.

Before implementing that, the execution path was traced end to end:
`runCollector` → `storeRawRecord` → `runIngestionPipeline` →
`reconcileMissingRecords`. That trace, and a direct empirical
reproduction against the real (unmodified, fully sequential) code,
found a genuine correctness problem, not a hypothetical one.

## The problem

`packages/ingestion`'s `runIngestionPipeline` and
`reconcileMissingRecords` both scope their queries by `collectorId`
only:

- `runIngestionPipeline({ collectorId, normalize })` selects every
  not-yet-processed `raw_record` row for that `collectorId` — across
  every company tracked on it — and applies `normalize`, which is
  closured to **one specific company's `companyId`**.
- `reconcileMissingRecords({ collectorId, currentExternalIds })`
  compares every externalId ever seen under that `collectorId` against
  the current company's own fetch, and fires `JobClosed` for whatever
  it doesn't recognize — using that same one company's `companyId`.

`raw_record` itself has no company column at all (verified directly
against its schema) — nothing about Raw Record storage or these two
functions' queries is company-aware. Today's sequential loop is safe
only by accident of timing: each company's records are fully stored
*and* processed before the next company's fetch begins, so there is
never a moment where one company's unprocessed or still-open records
are visible to another company's turn.

This was confirmed two ways:

1. **By trace** — reading the exact query shapes above.
2. **Empirically**, against the real, unmodified, fully sequential
   code, with zero concurrency involved: two companies (A, B) tracked
   under the same Collector, each with one currently-open job. Running
   `runGreenhouseCollector([A, B])` produced a `JobClosed` event for
   **A's still-open job, attributed to B's `companyId`** — proving the
   underlying flaw already exists independent of any concurrency work,
   triggered simply by more than one company sharing a Collector and
   being processed in the same run. (This pre-existing issue is
   separate from this ADR's scope — see the note at the end.)

Concurrency would only make the *window* for this bigger and the
*timing* nondeterministic: two companies' fetch-and-persist sequences
overlapping is exactly the condition under which one company's
normalizer could pick up another's Raw Records, or reconcile another's
still-open roles as closed.

## Decision

**Only the external network fetch runs concurrently.** Persistence,
ingestion, and reconciliation remain fully sequential, in original
input order — unchanged from before this milestone.

Concretely, `runCollector` now has two phases:

1. **Resolve + fetch**, in bounded concurrent batches (`Promise.all`
   over fixed-size chunks). Each company resolves its own
   `company_source_identity` row (keyed by its own `sourceIdentifier`,
   never shared with another company) and fetches from its own
   external endpoint. Nothing in this phase touches state another
   company's fetch could race on.
2. **Persist, ingest, reconcile**, sequentially, one company at a time,
   in the original input order — exactly the code path that existed
   before this milestone, untouched.

`packages/ingestion` is not modified. That package is intentionally
out of scope for Milestone 11.

## Consequences

- The real bottleneck this session's own testing surfaced (multi-minute
  collector runs, network/TLS-bound rather than database-bound) is
  addressed: fetch is the slow part, and it's now concurrent.
- Full end-to-end collector concurrency remains deferred. A Collector
  tracking hundreds of companies still processes the persist/ingest/
  reconcile phase for each one sequentially — bounded by real database
  round-trip time, not network latency, which is a substantially
  smaller cost per company based on this session's own measurements.
- `packages/ingestion`'s behavior, tests, and guarantees are completely
  unchanged.

## Future work required to safely parallelize the rest

`runIngestionPipeline` and `reconcileMissingRecords` would need to
become company-scoped — filtering `raw_record` by more than just
`collectorId`, which likely means either adding a company reference to
`raw_record` itself or threading a company-scoping parameter through
both functions' queries. That's a real change to a package this
milestone was explicitly told to leave alone, with its own test and
migration implications, and belongs in a future milestone that takes
`packages/ingestion`'s design as its actual subject — not as a
side effect of a company-directory milestone.

## A separate, more urgent finding

The empirical reproduction above incidentally proved that the
underlying cross-contamination bug is not concurrency-dependent — it
already reproduces in today's live, fully sequential production code,
for any Collector tracking more than one company (which the Greenhouse
Collector already does: ConsenSys, Coinbase, and Paradigm all share
one `collectorId`). This is a pre-existing correctness issue, not
something introduced by or specific to this milestone's work, and
fixing it is out of scope here for the same reason described above.
It's recorded here because it was discovered in the course of this
investigation, not invented by it, and needs its own attention
independent of this ADR's decision.
