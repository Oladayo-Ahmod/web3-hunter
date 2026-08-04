import type { SignalDetector } from "./types";

/**
 * Canonical Signal Type names — the same "registered once, referenced by
 * name everywhere else" discipline `@web3-hunter/events` applies to Event
 * Types (see that package's registry.ts), applied one layer up. Kept
 * deliberately lighter-weight than the Event registry: Signal metadata is
 * uniform (weight + reasoning + source Event IDs) across every type, so
 * there's no per-type schema to validate — just a name to reserve.
 */
const signalTypes = new Set<string>();

export function registerSignalType(name: string): string {
  if (signalTypes.has(name)) {
    throw new Error(
      `Signal type "${name}" is already registered. Canonical Signal names must be ` +
        "defined exactly once — see packages/scoring's registry.",
    );
  }
  signalTypes.add(name);
  return name;
}

export function isRegisteredSignalType(name: string): boolean {
  return signalTypes.has(name);
}

export function listSignalTypes(): readonly string[] {
  return [...signalTypes];
}

/**
 * The open-for-extension list of Signal detectors the Signal Engine runs
 * against every unprocessed Event. A future Collector's Event types gain
 * Signal support by registering a new detector here — never by modifying
 * `run-scoring-pipeline.ts`, per docs/ROADMAP.md Milestone 3's
 * extensibility requirement.
 */
const detectors: SignalDetector[] = [];

export function registerSignalDetector(detector: SignalDetector): void {
  detectors.push(detector);
}

export function listSignalDetectors(): readonly SignalDetector[] {
  return [...detectors];
}
