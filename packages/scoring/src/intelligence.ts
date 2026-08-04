import type { CompanyIntelligenceState, SignalSummary } from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;

const TREND_WINDOW_DAYS = 30;
const MIN_SIGNALS_FOR_TREND = 2;
const TREND_INCREASE_RATIO = 1.5;
const TREND_DECREASE_RATIO = 2 / 3;

const CONFIDENCE_FRESHNESS_WINDOW_DAYS = 60;
const CONFIDENCE_SIGNAL_VOLUME_CAP = 5;

function sumWeightsInWindow(signals: readonly SignalSummary[], start: Date, end: Date): number {
  return signals
    .filter((signal) => signal.detectedAt >= start && signal.detectedAt < end)
    .reduce((sum, signal) => sum + signal.weight, 0);
}

function computeTrend(
  sorted: readonly SignalSummary[],
  asOf: Date,
): CompanyIntelligenceState["trend"] {
  if (sorted.length < MIN_SIGNALS_FOR_TREND) {
    return "insufficient-data";
  }

  const recentWindowStart = new Date(asOf.getTime() - TREND_WINDOW_DAYS * DAY_MS);
  const priorWindowStart = new Date(recentWindowStart.getTime() - TREND_WINDOW_DAYS * DAY_MS);

  const recentWeight = sumWeightsInWindow(sorted, recentWindowStart, new Date(asOf.getTime() + 1));
  const priorWeight = sumWeightsInWindow(sorted, priorWindowStart, recentWindowStart);

  if (priorWeight === 0) {
    return recentWeight > 0 ? "increasing" : "insufficient-data";
  }
  if (recentWeight >= priorWeight * TREND_INCREASE_RATIO) {
    return "increasing";
  }
  if (recentWeight <= priorWeight * TREND_DECREASE_RATIO) {
    return "decreasing";
  }
  return "stable";
}

function computeConfidence(sorted: readonly SignalSummary[], asOf: Date): number {
  const freshnessThreshold = new Date(asOf.getTime() - CONFIDENCE_FRESHNESS_WINDOW_DAYS * DAY_MS);
  const recentSignals = sorted.filter((signal) => signal.detectedAt >= freshnessThreshold);

  if (recentSignals.length === 0) {
    return 0;
  }

  const averageWeight =
    recentSignals.reduce((sum, signal) => sum + signal.weight, 0) / recentSignals.length;
  const volumeFactor =
    Math.min(recentSignals.length, CONFIDENCE_SIGNAL_VOLUME_CAP) / CONFIDENCE_SIGNAL_VOLUME_CAP;

  return roundTo(averageWeight * volumeFactor, 2);
}

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/**
 * Computes a Company's current Intelligence state from its full Signal
 * history, as of a specific point in time — never wall-clock "now" (see
 * `SignalDetectionContext.asOf`). Pure and deterministic: the same
 * signals and the same `asOf` always produce the same state, which is
 * what makes both live updates and full replay-rebuilds
 * (`rebuildCompanyIntelligence`) produce identical results.
 *
 * - `trend` compares total Signal weight in the last
 *   {@link TREND_WINDOW_DAYS} days against the {@link TREND_WINDOW_DAYS}
 *   days before that.
 * - `confidence` averages the weight of Signals still "fresh" (within
 *   {@link CONFIDENCE_FRESHNESS_WINDOW_DAYS} days of `asOf`), scaled down
 *   when there are very few of them.
 *
 * These thresholds are a first, defensible version — see
 * docs/ROADMAP.md Milestone 3 — not a calibrated model.
 */
export function computeCompanyIntelligence(
  signals: readonly SignalSummary[],
  asOf: Date,
): CompanyIntelligenceState {
  if (signals.length === 0) {
    return { trend: "insufficient-data", confidence: 0, signalCount: 0, lastSignalAt: null };
  }

  const sorted = [...signals].sort((a, b) => a.detectedAt.getTime() - b.detectedAt.getTime());
  const lastSignalAt = sorted[sorted.length - 1]!.detectedAt;

  return {
    trend: computeTrend(sorted, asOf),
    confidence: computeConfidence(sorted, asOf),
    signalCount: signals.length,
    lastSignalAt,
  };
}

/** Whether two Intelligence states differ in any field a consumer could observe. */
export function intelligenceStatesEqual(
  a: CompanyIntelligenceState,
  b: CompanyIntelligenceState,
): boolean {
  return (
    a.trend === b.trend &&
    a.confidence === b.confidence &&
    a.signalCount === b.signalCount &&
    (a.lastSignalAt?.getTime() ?? null) === (b.lastSignalAt?.getTime() ?? null)
  );
}
