import type { Normalizer } from "@web3-hunter/ingestion";
import {
  createSecurityDisclosureRouteNormalizer,
  type CanonicalSecurityDisclosureRoute,
} from "../security-disclosure-events";

const FETCH_TIMEOUT_MS = 5_000;

/**
 * The fields this Collector extracts from an RFC 9116 `security.txt` —
 * every other field the spec allows (`Acknowledgments`, `Hiring`,
 * `Preferred-Languages`, `Encryption`) is read but discarded: it carries
 * no disclosure-route information this system acts on. `Contact` is kept
 * as an array, in the source's own order (RFC 9116 §2.5.3: listed in
 * order of preference) — never deduplicated or re-ranked.
 */
export interface ParsedSecurityTxt {
  contacts: string[];
  policyUrl: string | null;
  canonicalUrl: string | null;
  /** The raw `Expires:` value, exactly as published — RFC 9116 requires ISO 8601, but never reformatted here; parsed for staleness only at read time, in `@web3-hunter/application`. */
  expires: string | null;
}

/**
 * Parses RFC 9116 `security.txt` content. Pure and synchronous — no I/O,
 * so a future second caller (a test, a different fetch path) never needs
 * to re-implement this. Unknown fields and malformed lines are silently
 * skipped, per the spec's own forward-compatibility guidance (§2.3): a
 * publisher adding a field this system doesn't know about is not an
 * error. The *first* occurrence of `Policy`/`Canonical`/`Expires` wins if
 * a (non-conformant) file repeats them — `Contact` is the only field the
 * spec itself allows to repeat.
 */
export function parseSecurityTxt(text: string): ParsedSecurityTxt {
  const contacts: string[] = [];
  let policyUrl: string | null = null;
  let canonicalUrl: string | null = null;
  let expires: string | null = null;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf(":");
    if (separatorIndex === -1) {
      continue;
    }

    const field = line.slice(0, separatorIndex).trim().toLowerCase();
    const value = line.slice(separatorIndex + 1).trim();
    if (!value) {
      continue;
    }

    switch (field) {
      case "contact":
        contacts.push(value);
        break;
      case "policy":
        policyUrl ??= value;
        break;
      case "canonical":
        canonicalUrl ??= value;
        break;
      case "expires":
        expires ??= value;
        break;
      default:
        break;
    }
  }

  return { contacts, policyUrl, canonicalUrl, expires };
}

export interface SecurityTxtFetchResult extends ParsedSecurityTxt {
  /** Whether a `security.txt` was actually found at this origin — `false` means a clean 404, a real, legitimate "not published," never a fetch failure (those throw instead). */
  found: boolean;
  /** The exact URL fetched — RFC 9116 §3's `/.well-known/` location, the only one this Collector checks (the deprecated top-level `/security.txt` fallback is not attempted, per the current spec's own recommendation against relying on it). */
  sourceUrl: string;
}

const NOT_FOUND_RESULT: Omit<SecurityTxtFetchResult, "sourceUrl"> = {
  found: false,
  contacts: [],
  policyUrl: null,
  canonicalUrl: null,
  expires: null,
};

/**
 * Fetches and parses a website's `/.well-known/security.txt` (RFC 9116) —
 * one bounded GET per call, a 5s timeout, no retries, no crawling beyond
 * this single, standard, publicly-intended location. A 404 is a genuine,
 * legitimate "not published" result, distinguished from every other
 * failure mode (timeout, DNS failure, 5xx, malformed URL), which throw —
 * callers must not conflate "this target has no security.txt" with "we
 * couldn't check."
 */
export async function fetchSecurityTxt(websiteUrl: string): Promise<SecurityTxtFetchResult> {
  const origin = new URL(websiteUrl).origin;
  const sourceUrl = `${origin}/.well-known/security.txt`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(sourceUrl, { signal: controller.signal, redirect: "follow" });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`security.txt request failed for "${sourceUrl}": ${reason}`);
  } finally {
    clearTimeout(timeoutId);
  }

  if (response.status === 404) {
    return { ...NOT_FOUND_RESULT, sourceUrl };
  }

  if (!response.ok) {
    throw new Error(
      `security.txt request failed for "${sourceUrl}": ${response.status} ${response.statusText}`,
    );
  }

  const text = await response.text();
  return { found: true, sourceUrl, ...parseSecurityTxt(text) };
}

function toCanonicalSecurityTxt(payload: unknown): CanonicalSecurityDisclosureRoute {
  const result = payload as SecurityTxtFetchResult;
  return {
    fields: {
      routeType: "security-txt",
      found: result.found,
      sourceUrl: result.sourceUrl,
      contacts: result.contacts,
      policyUrl: result.policyUrl,
      canonicalUrl: result.canonicalUrl,
      expires: result.expires,
    },
    // Neither a 404 nor a found security.txt carries its own "last
    // changed" timestamp (RFC 9116's `Expires:` is a staleness marker
    // the publisher sets, not a last-modified time) — wall-clock fetch
    // time is the only honest `occurredAt` available, mirrors
    // `./github-security-policy.ts`'s equivalent normalizer.
    occurredAt: new Date(),
  };
}

/**
 * Builds this Collector's normalizer for one Security Target's
 * `security.txt` check. All the canonical-event logic (Recorded vs.
 * Updated vs. skip) lives in `../security-disclosure-events`, shared
 * with `./github-security-policy.ts`'s own normalizer — this module
 * supplies only this route type's own payload shape.
 */
export function createSecurityTxtNormalizer(securityTargetId: string): Normalizer {
  return createSecurityDisclosureRouteNormalizer(securityTargetId, toCanonicalSecurityTxt);
}
