/**
 * A minimal, source-agnostic view of an Event, supplied to Signal
 * detectors. Deliberately narrower than the full `EventEnvelope` from
 * `@web3-hunter/events` — detectors don't need collector identity,
 * confidence, or provenance, just enough to interpret what happened and
 * when.
 */
export interface RecentCompanyEvent {
  id: string;
  type: string;
  occurredAt: Date;
  metadata: unknown;
}

/**
 * Everything a Signal detector needs beyond the triggering Event itself.
 * `asOf` is always the triggering Event's `occurredAt` — never wall-clock
 * "now" — which is what keeps Signal generation replay-deterministic (see
 * docs/ROADMAP.md Milestone 3, acceptance criterion 5).
 */
export interface SignalDetectionContext {
  companyId: string;
  asOf: Date;
  /** Every Source Event for this company up to and including `asOf`, ordered oldest to newest. */
  recentEvents: readonly RecentCompanyEvent[];
}

export interface SignalCandidate {
  signalType: string;
  /** 0..1: how strongly this Signal indicates hiring intent. */
  weight: number;
  reasoning: string;
  /** Provenance: which Event(s) justify this Signal. Always non-empty. */
  sourceEventIds: readonly string[];
}

/**
 * A pure, synchronous transform from a triggering Event (plus context) to
 * zero or more Signals. Pure and side-effect-free by contract — no I/O, no
 * `@web3-hunter/db` or `@web3-hunter/events` access — which is what keeps
 * detectors trivially unit-testable and what makes the Signal Engine's
 * runner (`run-scoring-pipeline.ts`) reusable across every future
 * Collector's Event types unchanged: adding support for a new source is
 * "register a new detector," never "modify the runner."
 */
export type SignalDetector = (
  triggeringEvent: RecentCompanyEvent,
  context: SignalDetectionContext,
) => readonly SignalCandidate[];

export interface SignalSummary {
  id: string;
  signalType: string;
  weight: number;
  detectedAt: Date;
}

export type IntelligenceTrend = "insufficient-data" | "increasing" | "stable" | "decreasing";

export interface CompanyIntelligenceState {
  trend: IntelligenceTrend;
  confidence: number;
  signalCount: number;
  lastSignalAt: Date | null;
}
