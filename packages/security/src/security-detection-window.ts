const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Buckets a point in time into its ISO-8601 week (e.g. `"2026-W03"`) —
 * mirrors `packages/scoring/src/detection-window.ts`'s
 * `computeDetectionWindow` exactly. Duplicated rather than imported:
 * `packages/security` must not depend sideways on `packages/scoring`
 * (docs/ARCHITECTURE.md §3's one-way dependency rule), and this is a
 * small, stable, pure function with no reasonable way to drift once
 * copied — the same trade-off this phase's `types.ts` already makes.
 */
export function computeSecurityDetectionWindow(date: Date): string {
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));

  const isoDayNumber = (target.getUTCDay() + 6) % 7; // Monday = 0 ... Sunday = 6
  target.setUTCDate(target.getUTCDate() - isoDayNumber + 3);

  const isoYear = target.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(isoYear, 0, 4));
  const firstThursdayDayNumber = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstThursdayDayNumber + 3);

  const week = 1 + Math.round((target.getTime() - firstThursday.getTime()) / (7 * DAY_MS));

  return `${isoYear}-W${String(week).padStart(2, "0")}`;
}
