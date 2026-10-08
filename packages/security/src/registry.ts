import type { SecuritySignalDetector } from "./types";

/**
 * Canonical Security Signal Type names — mirrors
 * `packages/scoring/src/registry.ts`'s `registerSignalType` exactly: a
 * name must be reserved here, exactly once, before anything produces a
 * Security Signal of that type.
 */
const securitySignalTypes = new Set<string>();

export function registerSecuritySignalType(name: string): string {
  if (securitySignalTypes.has(name)) {
    throw new Error(
      `Security Signal type "${name}" is already registered. Canonical Security Signal ` +
        "names must be defined exactly once — see packages/security's registry.",
    );
  }
  securitySignalTypes.add(name);
  return name;
}

export function isRegisteredSecuritySignalType(name: string): boolean {
  return securitySignalTypes.has(name);
}

export function listSecuritySignalTypes(): readonly string[] {
  return [...securitySignalTypes];
}

/**
 * The open-for-extension list of Security Signal detectors a future
 * Security Signal Engine would run against every unprocessed Event —
 * mirrors `packages/scoring`'s `detectors` registry exactly. Deliberately
 * empty for this phase, per the approved Phase 1 scope: no detector
 * exists yet, and none should be registered ahead of a real source of
 * Security Events to run them against.
 */
const detectors: SecuritySignalDetector[] = [];

export function registerSecuritySignalDetector(detector: SecuritySignalDetector): void {
  detectors.push(detector);
}

export function listSecuritySignalDetectors(): readonly SecuritySignalDetector[] {
  return [...detectors];
}
