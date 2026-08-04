import { uuidv7 } from "uuidv7";

/**
 * Generates a globally unique, time-sortable identifier (UUIDv7) for use as
 * a primary key, per docs/DATABASE.md §4 ("Primary keys"). Sorting rows by
 * this ID is equivalent to sorting by creation time, and — unlike an
 * auto-incrementing integer — it can be generated safely by multiple
 * concurrent writers (Collectors, Scoring workers) with no central
 * coordination.
 */
export function generateId(): string {
  return uuidv7();
}
