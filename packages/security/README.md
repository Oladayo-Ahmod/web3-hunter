# @web3-hunter/security

The Security Research domain — Phase 1 (domain foundation only).

See [docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md#packagessecurity) for the package's role and boundary, and this package's own source files for the detail: each schema table and each store function documents the specific existing pattern it mirrors (`signal`/`company_intelligence`/`opportunity` and their `packages/scoring` counterparts) and exactly what it deliberately does not do yet.

## Current scope

- `security_target`, `security_target_intelligence`, `security_signal` (+ its generation ledger), `security_opportunity`, `audit_contest`, `bug_bounty` — six tables (`packages/db/src/schema/`), reusing the event-sourced/projection/deterministic-ID pattern `scoring` already established, not the tables themselves.
- `opportunity-id.ts` — the Security Opportunity Type vocabulary (`AUDIT_CONTEST`, `BUG_BOUNTY`, `ACTIVE_PROTOCOL`, `SHADOW_AUDIT`, `SECURITY_RESEARCH`, `DISCLOSURE`) and deterministic Security Opportunity ID derivation.
- `registry.ts` — the Security Signal type/detector registry, the same shape as `packages/scoring`'s, extended with a per-type `qualifiesForOpportunity` declaration (see `security-opportunity-detection.ts`). Three detectors are registered as of Phase 2B Step 1 (`detectors/defillama-detectors.ts`): `NEW_PROTOCOL` (does not qualify an Opportunity on its own), `TVL_GROWTH` and `AUDIT_COVERAGE_GAP` (each does).
- Plain persistence store functions for each table, plus the Signal/Intelligence/Opportunity orchestration (`security-signal-generation.ts`, `security-intelligence-update.ts`, `security-opportunity-evaluation.ts`, `run-security-scoring-pipeline.ts`) mirroring `packages/scoring`'s pipeline.

## Explicitly not yet built

No final Security Opportunity scoring model exists — `security_opportunity.score` stays `null`; qualification is a deliberately provisional, documented-as-such policy (`security-opportunity-detection.ts`), not a calibrated threshold. No source besides DefiLlama is integrated yet (Immunefi, GitHub, Etherscan, Snapshot — see the Phase 2A research report), and nothing in `packages/application`, matching, decision, or notifications is aware of this package yet.
