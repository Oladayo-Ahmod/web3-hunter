import type { SecuritySignalDetector } from "./types";

/**
 * A Signal Type's declared properties, decided once at registration time
 * by whichever module registers it.
 *
 * `qualifiesForOpportunity` is the extensibility point the Phase 2B Step
 * 1 correction introduced: whether a Signal of this type, by itself, is
 * sufficient to qualify its Security Target for a (placeholder, unscored)
 * Security Opportunity — see `security-opportunity-detection.ts`. Each
 * signal type declares its own stance here, at the one place its name is
 * defined, rather than `meetsSecurityOpportunityThreshold` (or the
 * pipeline) growing a conditional per signal type. A future signal type
 * (e.g. a bug-bounty-sourced one) adds a single line at its own
 * registration call — no other file changes.
 */
export interface SecuritySignalTypeOptions {
  qualifiesForOpportunity: boolean;
}

/**
 * Canonical Security Signal Type names, and their declared properties —
 * mirrors `packages/scoring/src/registry.ts`'s `registerSignalType`
 * exactly, extended with `SecuritySignalTypeOptions`: a name (and its
 * options) must be reserved here, exactly once, before anything produces
 * a Security Signal of that type.
 */
const securitySignalTypes = new Map<string, SecuritySignalTypeOptions>();

export function registerSecuritySignalType(
  name: string,
  options: SecuritySignalTypeOptions,
): string {
  if (securitySignalTypes.has(name)) {
    throw new Error(
      `Security Signal type "${name}" is already registered. Canonical Security Signal ` +
        "names must be defined exactly once — see packages/security's registry.",
    );
  }
  securitySignalTypes.set(name, options);
  return name;
}

export function isRegisteredSecuritySignalType(name: string): boolean {
  return securitySignalTypes.has(name);
}

export function listSecuritySignalTypes(): readonly string[] {
  return [...securitySignalTypes.keys()];
}

/** Whether a Signal of this type alone is enough to qualify its Security Target for a (placeholder) Opportunity — see `SecuritySignalTypeOptions`. Unregistered names never qualify. */
export function doesSignalTypeQualifyForOpportunity(name: string): boolean {
  return securitySignalTypes.get(name)?.qualifiesForOpportunity ?? false;
}

/**
 * The open-for-extension list of Security Signal detectors the Security
 * Scoring Pipeline runs against every unprocessed Event — mirrors
 * `packages/scoring`'s `detectors` registry exactly. Populated by each
 * detector module registering itself at load time (see
 * `detectors/defillama-detectors.ts`), never by a change here.
 */
const detectors: SecuritySignalDetector[] = [];

export function registerSecuritySignalDetector(detector: SecuritySignalDetector): void {
  detectors.push(detector);
}

export function listSecuritySignalDetectors(): readonly SecuritySignalDetector[] {
  return [...detectors];
}
