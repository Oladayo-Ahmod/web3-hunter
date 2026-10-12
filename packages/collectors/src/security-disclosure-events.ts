import { registerEventType, type NormalizedEvent, type Normalizer } from "@web3-hunter/ingestion";
import { z } from "zod";

/**
 * The canonical vulnerability-disclosure-route vocabulary the Security
 * Disclosure Collector normalizes into — `SecurityDisclosureRouteRecorded`/
 * `SecurityDisclosureRouteUpdated`, with one shared
 * `SecurityDisclosureRouteFields` shape covering both of this Collector's
 * route types (`security-txt`, `github-security-policy`). One shared
 * shape, not two, so a future third route type (e.g. a dedicated
 * `/security` page) extends this registry rather than inventing a
 * parallel one — mirrors `./bounty-program-events.ts`'s role for the
 * bounty-catalog Collector.
 *
 * Deliberately records a "not found" result as a real Event, not a
 * skipped poll: a target whose official site has no `security.txt` is a
 * fact worth a discoverable, timestamped record — "we checked, as of
 * this date, and found nothing" is different from "we have never
 * checked," and only a stored Event (not a transient read) preserves
 * that distinction when a later poll finds it still absent.
 */

export const SECURITY_DISCLOSURE_ROUTE_TYPES = ["security-txt", "github-security-policy"] as const;
export type SecurityDisclosureRouteType = (typeof SECURITY_DISCLOSURE_ROUTE_TYPES)[number];

const securityDisclosureRouteFieldsSchema = z.object({
  routeType: z.enum(SECURITY_DISCLOSURE_ROUTE_TYPES),
  /** Whether the checked resource actually existed — see this module's doc comment on why "not found" is still a real, recorded fact. */
  found: z.boolean(),
  /** The exact URL this Collector fetched (never a guess at where the resource "should" be). */
  sourceUrl: z.string(),
  /** RFC 9116 `Contact:` values, in the source's own preference order — always `[]` for `routeType: "github-security-policy"`, which has no equivalent field. */
  contacts: z.array(z.string()),
  /** `security-txt`'s `Policy:` value, or `github-security-policy`'s `SECURITY.md` page URL — both are "where the disclosure policy itself is published," unified under one field since exactly one of the two route types ever supplies it for a given Event. */
  policyUrl: z.string().nullable(),
  /** `security-txt`'s `Canonical:` value only — always `null` for `github-security-policy`. */
  canonicalUrl: z.string().nullable(),
  /** `security-txt`'s own `Expires:` value, exactly as published (RFC 9116 requires ISO 8601, but this is never reformatted or validated here) — always `null` for `github-security-policy`, which has no equivalent field. Staleness is derived from this at read time, in `@web3-hunter/application`, never here. */
  expires: z.string().nullable(),
});

export type SecurityDisclosureRouteFields = z.infer<typeof securityDisclosureRouteFieldsSchema>;

const securityDisclosureRouteRecordedMetadataSchema = securityDisclosureRouteFieldsSchema;
const securityDisclosureRouteUpdatedMetadataSchema = securityDisclosureRouteFieldsSchema.extend({
  changedFrom: securityDisclosureRouteFieldsSchema.partial(),
});

export const SecurityDisclosureRouteRecorded = registerEventType({
  name: "SecurityDisclosureRouteRecorded",
  category: "source",
  version: 1,
  metadataSchema: securityDisclosureRouteRecordedMetadataSchema,
});

export const SecurityDisclosureRouteUpdated = registerEventType({
  name: "SecurityDisclosureRouteUpdated",
  category: "source",
  version: 1,
  metadataSchema: securityDisclosureRouteUpdatedMetadataSchema,
});

/** A source fetch result mapped to the canonical shape — the one thing this Collector's normalizer supplies. */
export interface CanonicalSecurityDisclosureRoute {
  fields: SecurityDisclosureRouteFields;
  /** When this check was actually performed — wall-clock fetch time, since neither route type's source supplies its own "last changed" timestamp (unlike DefiLlama's `updatedDate` or Immunefi's). */
  occurredAt: Date;
}

function diffSecurityDisclosureRouteFields(
  current: SecurityDisclosureRouteFields,
  previous: SecurityDisclosureRouteFields,
): Partial<SecurityDisclosureRouteFields> {
  const changedFrom: Partial<SecurityDisclosureRouteFields> = {};

  for (const key of Object.keys(current) as (keyof SecurityDisclosureRouteFields)[]) {
    if (JSON.stringify(current[key]) !== JSON.stringify(previous[key])) {
      (changedFrom as Record<string, unknown>)[key] = previous[key];
    }
  }

  return changedFrom;
}

/**
 * Builds the Security Disclosure Collector's normalizer for one Security
 * Target's one route type. Pure and synchronous, per `Normalizer`'s
 * contract. Each route type is ingested under its own `sourceIdentifier`
 * (e.g. `${securityTargetId}:security-txt`), so a change in one route
 * type never produces a spurious diff against the other.
 */
export function createSecurityDisclosureRouteNormalizer(
  securityTargetId: string,
  toCanonical: (payload: unknown) => CanonicalSecurityDisclosureRoute,
): Normalizer {
  return (input) => {
    const current = toCanonical(input.payload);

    if (!input.previousPayload) {
      const event: NormalizedEvent = {
        type: SecurityDisclosureRouteRecorded.name,
        metadata: current.fields,
        occurredAt: current.occurredAt,
        confidence: 1,
        relatedEntityType: "security_target",
        relatedEntityId: securityTargetId,
      };
      return event;
    }

    const previous = toCanonical(input.previousPayload);
    const changedFrom = diffSecurityDisclosureRouteFields(current.fields, previous.fields);

    if (Object.keys(changedFrom).length === 0) {
      return null;
    }

    const event: NormalizedEvent = {
      type: SecurityDisclosureRouteUpdated.name,
      metadata: { ...current.fields, changedFrom },
      occurredAt: current.occurredAt,
      confidence: 1,
      relatedEntityType: "security_target",
      relatedEntityId: securityTargetId,
    };
    return event;
  };
}
