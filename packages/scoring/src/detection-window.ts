const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Buckets a point in time into its ISO-8601 week (e.g. `"2026-W03"`),
 * anchored to UTC so the same instant always maps to the same window
 * regardless of the machine's local timezone — required for replay
 * determinism (docs/ROADMAP.md Milestone 3, acceptance criterion 5).
 *
 * This is what "Detection Window" means for the deterministic Opportunity
 * IDs described in that milestone's approved refinement: an Opportunity
 * detected from activity in the same ISO week resolves to the same
 * `(company, type, window)` key, and therefore the same ID, rather than
 * creating a new Opportunity for every individual Signal.
 */
export function computeDetectionWindow(date: Date): string {
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));

  // Shift to the Thursday of this ISO week (ISO weeks are defined by the
  // week containing the year's first Thursday).
  const isoDayNumber = (target.getUTCDay() + 6) % 7; // Monday = 0 ... Sunday = 6
  target.setUTCDate(target.getUTCDate() - isoDayNumber + 3);

  const isoYear = target.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(isoYear, 0, 4));
  const firstThursdayDayNumber = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstThursdayDayNumber + 3);

  const week = 1 + Math.round((target.getTime() - firstThursday.getTime()) / (7 * DAY_MS));

  return `${isoYear}-W${String(week).padStart(2, "0")}`;
}
