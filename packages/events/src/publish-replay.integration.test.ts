import { getDb, schema, type Database } from "@web3-hunter/db";
import { createTestDatabase, type TestDatabase } from "@web3-hunter/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { publishEvent } from "./publish";
import { registerEventType } from "./registry";
import { replayEvents } from "./replay";

const SourceTestEvent = registerEventType({
  name: "__test__PublishReplaySource",
  category: "source",
  version: 1,
  metadataSchema: z.object({ role: z.string() }),
});

const DerivedTestEvent = registerEventType({
  name: "__test__PublishReplayDerived",
  category: "decision",
  version: 1,
  metadataSchema: z.object({ decidedBy: z.string() }),
});

describe("publishEvent / replayEvents (integration)", () => {
  let testDb: TestDatabase;
  let db: Database;
  let collectorId: string;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    process.env.DATABASE_URL = testDb.connectionString;
    db = getDb();

    const [row] = await db
      .insert(schema.collector)
      .values({ slug: "test-collector", sourceType: "test" })
      .returning();
    collectorId = row!.id;
  }, 60_000);

  afterAll(async () => {
    await testDb.stop();
  });

  it("rejects publishing an unregistered event type", async () => {
    await expect(
      publishEvent({
        type: "__test__NeverRegistered",
        occurredAt: new Date(),
        confidence: 1,
        metadata: {},
        collectorId,
      }),
    ).rejects.toThrow(/unknown event type/i);
  });

  it("rejects metadata that fails the registered type's schema", async () => {
    await expect(
      publishEvent({
        type: SourceTestEvent.name,
        occurredAt: new Date(),
        confidence: 1,
        // `role` is required by SourceTestEvent's metadataSchema.
        metadata: {},
        collectorId,
      }),
    ).rejects.toThrow();
  });

  it("rejects a derived event published with no provenance", async () => {
    await expect(
      publishEvent({
        type: DerivedTestEvent.name,
        occurredAt: new Date(),
        confidence: 1,
        metadata: { decidedBy: "test" },
        sourceLabel: "decision-engine",
        provenance: [],
      }),
    ).rejects.toThrow();
  });

  it("publishes a source event and reads it back through replayEvents", async () => {
    const published = await publishEvent({
      type: SourceTestEvent.name,
      occurredAt: new Date("2026-01-01T00:00:00Z"),
      confidence: 0.8,
      metadata: { role: "founder" },
      collectorId,
    });

    const [replayed] = await replayEvents({ type: SourceTestEvent.name, collectorId });

    expect(replayed).toBeDefined();
    expect(replayed?.id).toBe(published.id);
    expect(replayed?.metadata).toEqual({ role: "founder" });
    expect(replayed?.confidence).toBe(0.8);
    expect(replayed?.provenance).toEqual([]);
  });

  it("publishes a derived event with provenance and reads the provenance back", async () => {
    const upstream = await publishEvent({
      type: SourceTestEvent.name,
      occurredAt: new Date("2026-01-02T00:00:00Z"),
      confidence: 0.7,
      metadata: { role: "engineer" },
      collectorId,
    });

    const derived = await publishEvent({
      type: DerivedTestEvent.name,
      occurredAt: new Date("2026-01-02T01:00:00Z"),
      confidence: 0.6,
      metadata: { decidedBy: "test-suite" },
      sourceLabel: "decision-engine",
      provenance: [upstream.id],
    });

    const [replayed] = await replayEvents({ type: DerivedTestEvent.name });

    expect(replayed?.id).toBe(derived.id);
    expect(replayed?.provenance).toEqual([upstream.id]);
  });

  it("rejects publishing a duplicate event ID", async () => {
    const first = await publishEvent({
      type: SourceTestEvent.name,
      occurredAt: new Date("2026-01-03T00:00:00Z"),
      confidence: 0.5,
      metadata: { role: "duplicate-test" },
      collectorId,
    });

    await expect(
      publishEvent({
        id: first.id,
        type: SourceTestEvent.name,
        occurredAt: new Date("2026-01-03T00:00:00Z"),
        confidence: 0.5,
        metadata: { role: "duplicate-test" },
        collectorId,
      }),
    ).rejects.toThrow(/already been published/i);
  });

  it("filters by occurredFrom/occurredTo", async () => {
    const inRange = await replayEvents({
      type: SourceTestEvent.name,
      occurredFrom: new Date("2026-01-01T12:00:00Z"),
      occurredTo: new Date("2026-01-02T12:00:00Z"),
    });

    expect(inRange.map((e) => e.metadata)).toEqual([{ role: "engineer" }]);
  });

  it("replays the same filter twice with identical ordering, payloads, and metadata", async () => {
    const first = await replayEvents({ collectorId });
    const second = await replayEvents({ collectorId });

    expect(first.length).toBeGreaterThan(0);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });
});
