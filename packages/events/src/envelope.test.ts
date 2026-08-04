import { describe, expect, it } from "vitest";
import { eventEnvelopeSchema } from "./envelope";

function validSourceEnvelope(overrides: Record<string, unknown> = {}) {
  return {
    id: "019474b4-9a3e-7c3e-9c3e-9c3e9c3e9c3e",
    type: "TestEvent",
    category: "source",
    version: 1,
    collectorId: "019474b4-9a3e-7c3e-9c3e-9c3e9c3e9c3f",
    sourceLabel: null,
    occurredAt: new Date("2026-01-01T00:00:00Z"),
    recordedAt: new Date("2026-01-01T00:00:01Z"),
    relatedEntityType: null,
    relatedEntityId: null,
    provenance: [],
    confidence: 0.9,
    metadata: { hello: "world" },
    ...overrides,
  };
}

describe("eventEnvelopeSchema", () => {
  it("accepts a well-formed source event with no provenance", () => {
    expect(eventEnvelopeSchema.safeParse(validSourceEnvelope()).success).toBe(true);
  });

  it("accepts a well-formed derived event with provenance and a sourceLabel", () => {
    const result = eventEnvelopeSchema.safeParse(
      validSourceEnvelope({
        category: "decision",
        collectorId: null,
        sourceLabel: "decision-engine",
        provenance: ["019474b4-9a3e-7c3e-9c3e-9c3e9c3e9c40"],
      }),
    );
    expect(result.success).toBe(true);
  });

  it("rejects a source event with a sourceLabel instead of a collectorId", () => {
    const result = eventEnvelopeSchema.safeParse(
      validSourceEnvelope({ collectorId: null, sourceLabel: "some-subsystem" }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects an event with both collectorId and sourceLabel set", () => {
    const result = eventEnvelopeSchema.safeParse(
      validSourceEnvelope({ sourceLabel: "some-subsystem" }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects an event with neither collectorId nor sourceLabel set", () => {
    const result = eventEnvelopeSchema.safeParse(validSourceEnvelope({ collectorId: null }));
    expect(result.success).toBe(false);
  });

  it("rejects a source event with non-empty provenance", () => {
    const result = eventEnvelopeSchema.safeParse(
      validSourceEnvelope({ provenance: ["019474b4-9a3e-7c3e-9c3e-9c3e9c3e9c40"] }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects a derived event with empty provenance", () => {
    const result = eventEnvelopeSchema.safeParse(
      validSourceEnvelope({
        category: "decision",
        collectorId: null,
        sourceLabel: "decision-engine",
        provenance: [],
      }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects a mismatched relatedEntityType/relatedEntityId pair", () => {
    const result = eventEnvelopeSchema.safeParse(
      validSourceEnvelope({ relatedEntityType: "company", relatedEntityId: null }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects confidence outside the [0, 1] range", () => {
    expect(eventEnvelopeSchema.safeParse(validSourceEnvelope({ confidence: 1.5 })).success).toBe(
      false,
    );
    expect(eventEnvelopeSchema.safeParse(validSourceEnvelope({ confidence: -0.1 })).success).toBe(
      false,
    );
  });
});
