import type { z } from "zod";
import type { EventCategory } from "./categories";

/**
 * Describes one canonical Event Type: its name, which category it belongs
 * to, its schema version (see docs/EVENT_MODEL.md §Event Versioning), and
 * the Zod schema its Metadata payload must satisfy.
 */
export interface EventTypeDefinition<TMetadata = unknown> {
  readonly name: string;
  readonly category: EventCategory;
  readonly version: number;
  readonly metadataSchema: z.ZodType<TMetadata>;
}

const registry = new Map<string, EventTypeDefinition>();

/**
 * The single place canonical Event Type names come from. Per
 * docs/EVENT_MODEL.md ("No subsystem may emit an ad hoc or free-form
 * Event Type"), a type must be registered here — exactly once — before
 * anything can publish it; `publishEvent` rejects any type it can't find
 * in this registry. This is what keeps the vocabulary open for extension
 * (a new Collector or engine registers its own types, wherever it's
 * implemented, without editing a shared union type here) while keeping
 * every reference to that type's name traceable back to one canonical
 * definition, rather than scattered as raw string literals throughout the
 * codebase — callers should hold onto and reuse the returned definition's
 * `.name`, not retype the string.
 *
 * Registering the same name twice is a programming error, not a runtime
 * possibility to handle gracefully: it would mean two different parts of
 * the codebase disagree about what a canonical name means.
 */
export function registerEventType<TMetadata>(
  definition: EventTypeDefinition<TMetadata>,
): EventTypeDefinition<TMetadata> {
  if (registry.has(definition.name)) {
    throw new Error(
      `Event type "${definition.name}" is already registered. Canonical event ` +
        "names must be defined exactly once — see @web3-hunter/events's registry.",
    );
  }

  if (!Number.isInteger(definition.version) || definition.version < 1) {
    throw new Error(
      `Event type "${definition.name}" has an invalid version (${definition.version}). ` +
        "Versions are positive integers, per docs/EVENT_MODEL.md §Event Versioning.",
    );
  }

  registry.set(definition.name, definition as EventTypeDefinition);
  return definition;
}

export function getEventType(name: string): EventTypeDefinition | undefined {
  return registry.get(name);
}

export function isRegisteredEventType(name: string): boolean {
  return registry.has(name);
}

export function listEventTypes(): readonly EventTypeDefinition[] {
  return [...registry.values()];
}
