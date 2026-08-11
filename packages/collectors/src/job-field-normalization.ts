import {
  EMPLOYMENT_TYPES,
  WORKPLACE_TYPES,
  type EmploymentType,
  type WorkplaceType,
} from "./hiring-events";

/**
 * Maps one source's own employment-type vocabulary onto the canonical set
 * (`EMPLOYMENT_TYPES`). Every source spells this differently — Ashby sends
 * `"FullTime"`, Lever sends `"Full-time"` — so this normalizes case and
 * separators before matching, rather than each Collector maintaining its
 * own copy of this list. Returns `null` for anything unrecognized: an
 * unmapped value is "we don't know," never a guess.
 */
export function normalizeEmploymentType(raw: string | null | undefined): EmploymentType | null {
  if (!raw) {
    return null;
  }
  const normalized = raw.toLowerCase().replace(/[\s-]/g, "");
  // A two-way substring check, not an exact match: covers both a source
  // abbreviating ("Intern" for "internship") and a source being more
  // specific than our vocabulary needs to be.
  const match = EMPLOYMENT_TYPES.find((type) => {
    const canonical = type.replace(/-/g, "");
    return normalized.includes(canonical) || canonical.includes(normalized);
  });
  return match ?? null;
}

/**
 * Maps one source's own workplace-type vocabulary onto the canonical set
 * (`WORKPLACE_TYPES`) — same reasoning as `normalizeEmploymentType`.
 */
export function normalizeWorkplaceType(raw: string | null | undefined): WorkplaceType | null {
  if (!raw) {
    return null;
  }
  const normalized = raw.toLowerCase().replace(/[\s-]/g, "");
  const match = WORKPLACE_TYPES.find((type) => normalized.includes(type));
  return match ?? null;
}

/**
 * Best-effort HTML → plain text, for sources (Greenhouse) that only offer
 * a job description as HTML, unlike Lever/Ashby's `descriptionPlain`. Not
 * a full HTML parser — decodes the handful of entities Greenhouse's own
 * `content` field is actually observed to use (it is itself HTML-encoded:
 * the field's string value contains literal `&lt;div&gt;`-style escaped
 * markup, not raw `<div>`), then strips tags and collapses whitespace.
 * Good enough for keyword-based relevance scoring (Milestone 13 Phase 2)
 * and a UI snippet; not guaranteed to reproduce the source's exact
 * formatting.
 */
export function stripHtmlToPlainText(html: string): string {
  const decoded = html
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");

  return decoded
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
