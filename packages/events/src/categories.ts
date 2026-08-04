/**
 * The category taxonomy from docs/EVENT_MODEL.md §Event Categories. This
 * set is closed and stable — adding an eighth category is an
 * architectural change to the event model itself (it would need a
 * corresponding update to that document), unlike adding a new Event
 * *type* within an existing category, which is expected to happen
 * routinely as new Collectors and engines are built. See ./registry.ts
 * for where the open, extensible vocabulary of type *names* lives.
 */
export const EVENT_CATEGORIES = [
  "source",
  "intelligence",
  "decision",
  "recommendation",
  "application",
  "user",
  "notification",
] as const;

export type EventCategory = (typeof EVENT_CATEGORIES)[number];

export function isEventCategory(value: string): value is EventCategory {
  return (EVENT_CATEGORIES as readonly string[]).includes(value);
}
