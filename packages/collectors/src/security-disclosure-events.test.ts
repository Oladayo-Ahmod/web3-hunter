import { describe, expect, it } from "vitest";
import {
  createSecurityDisclosureRouteNormalizer,
  SecurityDisclosureRouteRecorded,
  SecurityDisclosureRouteUpdated,
  type CanonicalSecurityDisclosureRoute,
} from "./security-disclosure-events";

const BASE_DATE = new Date("2026-01-01T00:00:00Z");

function toCanonical(payload: unknown): CanonicalSecurityDisclosureRoute {
  return payload as CanonicalSecurityDisclosureRoute;
}

function canonical(
  overrides: Partial<CanonicalSecurityDisclosureRoute["fields"]> = {},
): CanonicalSecurityDisclosureRoute {
  return {
    fields: {
      routeType: "security-txt",
      found: true,
      sourceUrl: "https://acme.xyz/.well-known/security.txt",
      contacts: ["mailto:security@acme.xyz"],
      policyUrl: null,
      canonicalUrl: null,
      expires: "2027-01-01T00:00:00.000Z",
      ...overrides,
    },
    occurredAt: BASE_DATE,
  };
}

describe("createSecurityDisclosureRouteNormalizer", () => {
  it("publishes SecurityDisclosureRouteRecorded when there is no previous payload", () => {
    const normalize = createSecurityDisclosureRouteNormalizer("target-1", toCanonical);
    const current = canonical();

    const event = normalize({
      rawRecordId: "raw-1",
      collectorId: "collector-1",
      payload: current,
      fetchedAt: BASE_DATE,
      previousPayload: null,
    });

    expect(event?.type).toBe(SecurityDisclosureRouteRecorded.name);
    expect(event?.relatedEntityType).toBe("security_target");
    expect(event?.relatedEntityId).toBe("target-1");
    expect(event?.metadata).toEqual(current.fields);
  });

  it("returns null when the payload is unchanged from the previous one", () => {
    const normalize = createSecurityDisclosureRouteNormalizer("target-1", toCanonical);
    const payload = canonical();

    const event = normalize({
      rawRecordId: "raw-2",
      collectorId: "collector-1",
      payload,
      fetchedAt: BASE_DATE,
      previousPayload: payload,
    });

    expect(event).toBeNull();
  });

  it("publishes SecurityDisclosureRouteUpdated with changedFrom when a field genuinely changes", () => {
    const normalize = createSecurityDisclosureRouteNormalizer("target-1", toCanonical);
    const previous = canonical({ found: false, contacts: [] });
    const current = canonical();

    const event = normalize({
      rawRecordId: "raw-3",
      collectorId: "collector-1",
      payload: current,
      fetchedAt: BASE_DATE,
      previousPayload: previous,
    });

    expect(event?.type).toBe(SecurityDisclosureRouteUpdated.name);
    expect(event?.metadata).toMatchObject({
      found: true,
      changedFrom: { found: false, contacts: [] },
    });
  });

  it("records a transition from found to not-found as a real, honest update, not a skip", () => {
    const normalize = createSecurityDisclosureRouteNormalizer("target-1", toCanonical);
    const previous = canonical();
    const current = canonical({ found: false, contacts: [], expires: null });

    const event = normalize({
      rawRecordId: "raw-4",
      collectorId: "collector-1",
      payload: current,
      fetchedAt: BASE_DATE,
      previousPayload: previous,
    });

    expect(event?.type).toBe(SecurityDisclosureRouteUpdated.name);
    expect((event?.metadata as { found: boolean }).found).toBe(false);
  });
});
