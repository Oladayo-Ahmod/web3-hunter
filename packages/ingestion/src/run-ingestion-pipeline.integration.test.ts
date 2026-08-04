import { getDb, schema } from "@web3-hunter/db";
import { createTestDatabase, type TestDatabase } from "@web3-hunter/db/testing";
import { registerEventType, replayEvents } from "@web3-hunter/events";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { deriveEventId } from "./deterministic-id";
import type { Normalizer } from "./normalizer";
import { reconcileMissingRecords, runIngestionPipeline } from "./run-ingestion-pipeline";
import { storeRawRecord } from "./store-raw-record";
import { z } from "zod";

const TestPosted = registerEventType({
  name: "__test__IngestionPosted",
  category: "source",
  version: 1,
  metadataSchema: z.object({ title: z.string() }),
});

const TestUpdated = registerEventType({
  name: "__test__IngestionUpdated",
  category: "source",
  version: 1,
  metadataSchema: z.object({ title: z.string() }),
});

const TestClosed = registerEventType({
  name: "__test__IngestionClosed",
  category: "source",
  version: 1,
  metadataSchema: z.object({ title: z.string() }),
});

const testNormalizer: Normalizer<{ title: string }> = (input) => {
  const payload = input.payload as { title: string };

  if (!input.previousPayload) {
    return { type: TestPosted.name, metadata: payload, occurredAt: new Date(), confidence: 1 };
  }

  const previous = input.previousPayload as { title: string };
  if (previous.title === payload.title) {
    return null;
  }

  return { type: TestUpdated.name, metadata: payload, occurredAt: new Date(), confidence: 1 };
};

describe("runIngestionPipeline / reconcileMissingRecords (integration)", () => {
  let testDb: TestDatabase;
  let collectorId: string;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    process.env.DATABASE_URL = testDb.connectionString;

    const [row] = await getDb()
      .insert(schema.collector)
      .values({ slug: "test-ingestion-collector", sourceType: "test" })
      .returning();
    collectorId = row!.id;
  }, 60_000);

  afterAll(async () => {
    await testDb.stop();
  });

  it("publishes JobPosted-equivalent events for first-seen Raw Records", async () => {
    await storeRawRecord({ collectorId, payload: { title: "Engineer" }, externalId: "job-1" });

    const result = await runIngestionPipeline({ collectorId, normalize: testNormalizer });

    expect(result.published).toBe(1);
    expect(result.skipped).toBe(0);

    const published = await replayEvents({ type: TestPosted.name, collectorId });
    expect(published).toHaveLength(1);
    expect(published[0]?.metadata).toEqual({ title: "Engineer" });
  });

  it("does nothing on a second run over the same, already-processed Raw Records", async () => {
    const result = await runIngestionPipeline({ collectorId, normalize: testNormalizer });

    expect(result.processed).toBe(0);
    expect(result.published).toBe(0);
  });

  it("records Raw Record -> Event provenance in the ledger", async () => {
    const [rawRecord] = await getDb()
      .select()
      .from(schema.rawRecord)
      .where(eq(schema.rawRecord.externalId, "job-1"));

    const [ledgerRow] = await getDb()
      .select()
      .from(schema.rawRecordIngestion)
      .where(eq(schema.rawRecordIngestion.rawRecordId, rawRecord!.id));

    expect(ledgerRow).toBeDefined();
    expect(ledgerRow?.eventId).not.toBeNull();

    const [event] = await getDb()
      .select()
      .from(schema.event)
      .where(eq(schema.event.id, ledgerRow!.eventId!));
    expect(event?.type).toBe(TestPosted.name);
  });

  it("publishes an updated event when a Raw Record's content changes for the same externalId", async () => {
    await storeRawRecord({
      collectorId,
      payload: { title: "Senior Engineer" },
      externalId: "job-1",
    });

    const result = await runIngestionPipeline({ collectorId, normalize: testNormalizer });

    expect(result.published).toBe(1);
    const updated = await replayEvents({ type: TestUpdated.name, collectorId });
    expect(updated).toHaveLength(1);
    expect(updated[0]?.metadata).toEqual({ title: "Senior Engineer" });
  });

  it("skips (does not publish) a Raw Record the normalizer determines is unchanged", async () => {
    // Same title as the previous capture, but forced as a distinct Raw
    // Record via a differing field so content-hash dedup doesn't collapse
    // it — the normalizer itself should be what decides there's nothing
    // new here.
    await storeRawRecord({
      collectorId,
      payload: { title: "Senior Engineer", noise: 1 },
      externalId: "job-1",
    });

    const result = await runIngestionPipeline({ collectorId, normalize: testNormalizer });

    expect(result.published).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it("recovers idempotently if an Event was already published under the same deterministic ID", async () => {
    await storeRawRecord({
      collectorId,
      payload: { title: "Recovered" },
      externalId: "job-recovery",
    });

    const [rawRecord] = await getDb()
      .select()
      .from(schema.rawRecord)
      .where(eq(schema.rawRecord.externalId, "job-recovery"));

    // Simulate a crash between publishing and writing the ledger row: the
    // Event already exists, but no raw_record_ingestion row references it.
    const { publishEvent } = await import("@web3-hunter/events");
    const eventId = deriveEventId(rawRecord!.id);
    await publishEvent({
      id: eventId,
      type: TestPosted.name,
      metadata: { title: "Recovered" },
      occurredAt: new Date(),
      confidence: 1,
      collectorId,
    });

    const result = await runIngestionPipeline({ collectorId, normalize: testNormalizer });

    expect(result.published).toBe(1);

    const [ledgerRow] = await getDb()
      .select()
      .from(schema.rawRecordIngestion)
      .where(eq(schema.rawRecordIngestion.rawRecordId, rawRecord!.id));
    expect(ledgerRow?.eventId).toBe(eventId);
  });

  it("reconciles a Raw Record whose externalId is missing from the current poll into a closed event", async () => {
    await storeRawRecord({
      collectorId,
      payload: { title: "About to close" },
      externalId: "job-closing",
    });
    await runIngestionPipeline({ collectorId, normalize: testNormalizer });

    const result = await reconcileMissingRecords({
      collectorId,
      currentExternalIds: [], // job-closing is no longer present
      normalizeMissing: ({ lastKnownPayload }) => ({
        type: TestClosed.name,
        metadata: lastKnownPayload as { title: string },
        occurredAt: new Date(),
        confidence: 1,
      }),
    });

    expect(result.published).toBeGreaterThanOrEqual(1);

    const closed = await replayEvents({ type: TestClosed.name, collectorId });
    expect(
      closed.some((event) => (event.metadata as { title: string }).title === "About to close"),
    ).toBe(true);
  });

  it("does not publish a duplicate closed event when reconciliation runs again", async () => {
    const before = await replayEvents({ type: TestClosed.name, collectorId });

    await reconcileMissingRecords({
      collectorId,
      currentExternalIds: [],
      normalizeMissing: ({ lastKnownPayload }) => ({
        type: TestClosed.name,
        metadata: lastKnownPayload as { title: string },
        occurredAt: new Date(),
        confidence: 1,
      }),
    });

    const after = await replayEvents({ type: TestClosed.name, collectorId });
    expect(after).toHaveLength(before.length);
  });
});
