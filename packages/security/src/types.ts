/**
 * A minimal, source-agnostic view of an Event, supplied to a future
 * Security Signal detector — mirrors `packages/scoring`'s
 * `RecentCompanyEvent` exactly, scoped to a Security Target instead of a
 * Company. Not yet consumed by anything in this phase (no detector is
 * registered) — this exists so `SecuritySignalDetector` has a real,
 * typed shape ready for Phase 2, rather than a placeholder.
 */
export interface RecentSecurityTargetEvent {
  id: string;
  type: string;
  occurredAt: Date;
  metadata: unknown;
}

/**
 * Everything a Security Signal detector will need beyond the triggering
 * Event itself — mirrors `SignalDetectionContext`.
 */
export interface SecuritySignalDetectionContext {
  securityTargetId: string;
  asOf: Date;
  /** Every Source Event for this Security Target up to and including `asOf`, ordered oldest to newest. */
  recentEvents: readonly RecentSecurityTargetEvent[];
}

export interface SecuritySignalCandidate {
  signalType: string;
  /** 0..1: how strongly this Signal indicates security-research relevance. */
  weight: number;
  reasoning: string;
  /** Provenance: which Event(s) justify this Signal. Always non-empty. */
  sourceEventIds: readonly string[];
}

/**
 * A pure, synchronous transform from a triggering Event (plus context)
 * to zero or more Security Signals — mirrors `SignalDetector` exactly.
 * No detector implements this type yet; `packages/security`'s detector
 * registry (`registry.ts`) is deliberately empty for this phase.
 */
export type SecuritySignalDetector = (
  triggeringEvent: RecentSecurityTargetEvent,
  context: SecuritySignalDetectionContext,
) => readonly SecuritySignalCandidate[];

export type SecurityIntelligenceTrend =
  "insufficient-data" | "increasing" | "stable" | "decreasing";

export interface SecurityTargetIntelligenceState {
  trend: SecurityIntelligenceTrend;
  confidence: number;
  signalCount: number;
  lastSignalAt: Date | null;
}

/** A persisted Security Signal's identity-relevant fields — mirrors `SignalSummary`. */
export interface SecuritySignalSummary {
  id: string;
  signalType: string;
  weight: number;
  detectedAt: Date;
}
