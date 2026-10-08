# @web3-hunter/security

The Security Research domain — Phase 1 (domain foundation only).

See [docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md#packagessecurity) for the package's role and boundary, and this package's own source files for the detail: each schema table and each store function documents the specific existing pattern it mirrors (`signal`/`company_intelligence`/`opportunity` and their `packages/scoring` counterparts) and exactly what it deliberately does not do yet.

## Current scope

- `security_target`, `security_target_intelligence`, `security_signal` (+ its generation ledger), `security_opportunity`, `audit_contest`, `bug_bounty` — six tables (`packages/db/src/schema/`), reusing the event-sourced/projection/deterministic-ID pattern `scoring` already established, not the tables themselves.
- `opportunity-id.ts` — the Security Opportunity Type vocabulary (`AUDIT_CONTEST`, `BUG_BOUNTY`, `ACTIVE_PROTOCOL`, `SHADOW_AUDIT`, `SECURITY_RESEARCH`, `DISCLOSURE`) and deterministic Security Opportunity ID derivation.
- `registry.ts` — the Security Signal type/detector registry, the same shape as `packages/scoring`'s. **Deliberately empty**: no detector is registered.
- Plain persistence store functions for each table — create/read only, no computation, no Event publishing.

## Explicitly not yet built

No Security Event Types are registered in `@web3-hunter/events`, no Collector produces Security Source Events, no Signal detector exists, no scoring/threshold math runs, and nothing in `packages/application`, `apps/web`, matching, decision, or notifications is aware of this package yet. Each is a later, separate phase.
