import { getDb, schema } from "@web3-hunter/db";
import { createTestDatabase, type TestDatabase } from "@web3-hunter/db/testing";
import { registerEventType, replayEvents } from "@web3-hunter/events";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
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
    await storeRawRecord({
      collectorId,
      payload: { title: "Engineer" },
      externalId: "job-1",
      sourceIdentifier: "test-source",
    });

    const result = await runIngestionPipeline({
      collectorId,
      sourceIdentifier: "test-source",
      normalize: testNormalizer,
    });

    expect(result.published).toBe(1);
    expect(result.skipped).toBe(0);

    const published = await replayEvents({ type: TestPosted.name, collectorId });
    expect(published).toHaveLength(1);
    expect(published[0]?.metadata).toEqual({ title: "Engineer" });
  });

  it("does nothing on a second run over the same, already-processed Raw Records", async () => {
    const result = await runIngestionPipeline({
      collectorId,
      sourceIdentifier: "test-source",
      normalize: testNormalizer,
    });

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
      sourceIdentifier: "test-source",
    });

    const result = await runIngestionPipeline({
      collectorId,
      sourceIdentifier: "test-source",
      normalize: testNormalizer,
    });

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
      sourceIdentifier: "test-source",
    });

    const result = await runIngestionPipeline({
      collectorId,
      sourceIdentifier: "test-source",
      normalize: testNormalizer,
    });

    expect(result.published).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it("recovers idempotently if an Event was already published under the same deterministic ID", async () => {
    await storeRawRecord({
      collectorId,
      payload: { title: "Recovered" },
      externalId: "job-recovery",
      sourceIdentifier: "test-source",
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

    const result = await runIngestionPipeline({
      collectorId,
      sourceIdentifier: "test-source",
      normalize: testNormalizer,
    });

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
      sourceIdentifier: "test-source",
    });
    await runIngestionPipeline({
      collectorId,
      sourceIdentifier: "test-source",
      normalize: testNormalizer,
    });

    const result = await reconcileMissingRecords({
      collectorId,
      sourceIdentifier: "test-source",
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
      sourceIdentifier: "test-source",
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

  // The direct regression proof for ADR 0002
  // (docs/adr/0002-source-scoped-ingestion.md): two source identifiers
  // under one Collector must never see each other's Raw Records or
  // reconciliation state.
  it("does not let one sourceIdentifier's Raw Records or reconciliation affect another's, under the same collectorId", async () => {
    await storeRawRecord({
      collectorId,
      payload: { title: "Company A's role" },
      externalId: "cross-a-1",
      sourceIdentifier: "source-a",
    });
    await storeRawRecord({
      collectorId,
      payload: { title: "Company B's role" },
      externalId: "cross-b-1",
      sourceIdentifier: "source-b",
    });

    // Only ingest source-a. source-b's Raw Record must remain untouched
    // by it — this is exactly the misattribution Bug A described.
    const resultA = await runIngestionPipeline({
      collectorId,
      sourceIdentifier: "source-a",
      normalize: testNormalizer,
    });
    expect(resultA.processed).toBe(1);
    expect(resultA.published).toBe(1);

    const stillUnprocessedB = await getDb()
      .select()
      .from(schema.rawRecord)
      .where(eq(schema.rawRecord.externalId, "cross-b-1"));
    const [ledgerForB] = await getDb()
      .select()
      .from(schema.rawRecordIngestion)
      .where(eq(schema.rawRecordIngestion.rawRecordId, stillUnprocessedB[0]!.id));
    expect(ledgerForB).toBeUndefined();

    // Now ingest source-b for real, then reconcile source-b with an
    // empty current fetch. Only source-b's own role should be
    // considered "missing" — source-a's still-open role must not be
    // reconciled as closed under source-b's identity. This is exactly
    // Bug B, reproduced and asserted against directly.
    await runIngestionPipeline({
      collectorId,
      sourceIdentifier: "source-b",
      normalize: testNormalizer,
    });

    await reconcileMissingRecords({
      collectorId,
      sourceIdentifier: "source-b",
      currentExternalIds: [], // source-b's own board is now empty
      normalizeMissing: ({ lastKnownPayload }) => ({
        type: TestClosed.name,
        metadata: lastKnownPayload as { title: string },
        occurredAt: new Date(),
        confidence: 1,
      }),
    });

    const closedTitles = (await replayEvents({ type: TestClosed.name, collectorId })).map(
      (event) => (event.metadata as { title: string }).title,
    );
    expect(closedTitles).toContain("Company B's role");
    expect(closedTitles).not.toContain("Company A's role");
  });

  // The regression proof specifically for findPreviousPayload's
  // sourceIdentifier scoping. The cross-contamination test above uses
  // different externalIds for its two sources, so it doesn't actually
  // exercise this — externalId alone would already isolate them. This
  // test deliberately reuses the *same* externalId across two different
  // sourceIdentifiers (different payload content, so it doesn't trip the
  // content-hash collision check in storeRawRecord) to prove
  // findPreviousPayload doesn't cross-correlate them.
  it("does not treat another sourceIdentifier's Raw Record as the 'previous' capture, even with the same externalId", async () => {
    await storeRawRecord({
      collectorId,
      payload: { title: "X's role" },
      externalId: "shared-external-id",
      sourceIdentifier: "source-x",
    });
    await runIngestionPipeline({
      collectorId,
      sourceIdentifier: "source-x",
      normalize: testNormalizer,
    });

    await storeRawRecord({
      collectorId,
      payload: { title: "Y's role" },
      externalId: "shared-external-id",
      sourceIdentifier: "source-y",
    });
    const resultY = await runIngestionPipeline({
      collectorId,
      sourceIdentifier: "source-y",
      normalize: testNormalizer,
    });

    // If findPreviousPayload ignored sourceIdentifier, it would find
    // source-x's row as source-y's "previous" (same externalId), and
    // the normalizer would see a title change and publish
    // __test__IngestionUpdated instead of a fresh
    // __test__IngestionPosted — this is precisely what the assertions
    // below rule out.
    expect(resultY.published).toBe(1);

    const postedForY = await replayEvents({ type: TestPosted.name, collectorId });
    expect(
      postedForY.some((event) => (event.metadata as { title: string }).title === "Y's role"),
    ).toBe(true);

    const updatedEvents = await replayEvents({ type: TestUpdated.name, collectorId });
    expect(
      updatedEvents.some((event) => (event.metadata as { title: string }).title === "Y's role"),
    ).toBe(false);
  });

  // Supabase egress fix: reconciliation used to re-fetch every stored
  // version of every already-closed job on every run, only to have
  // `publishEvent` reject the duplicate close event. `normalizeMissing`
  // is only ever called with a job's payload, so "was it called" is the
  // observable proxy for "was that payload read".
  describe("reconcileMissingRecords only reads jobs that still need a close event", () => {
    const closeFromPayload = ({ lastKnownPayload }: { lastKnownPayload: unknown }) => ({
      type: TestClosed.name,
      metadata: lastKnownPayload as { title: string },
      occurredAt: new Date(),
      confidence: 1,
    });

    async function storeAndIngest(sourceIdentifier: string, externalId: string, title: string) {
      await storeRawRecord({ collectorId, payload: { title }, externalId, sourceIdentifier });
      await runIngestionPipeline({ collectorId, sourceIdentifier, normalize: testNormalizer });
    }

    it("does not re-normalize a job whose close event was already published", async () => {
      const sourceIdentifier = "egress-already-closed";
      await storeAndIngest(sourceIdentifier, "old-a", "Old job A");
      await storeAndIngest(sourceIdentifier, "old-b", "Old job B");

      const normalizeMissing = vi.fn(closeFromPayload);
      const first = await reconcileMissingRecords({
        collectorId,
        sourceIdentifier,
        currentExternalIds: [],
        normalizeMissing,
      });
      expect(first.published).toBe(2);
      expect(normalizeMissing).toHaveBeenCalledTimes(2);

      normalizeMissing.mockClear();
      const second = await reconcileMissingRecords({
        collectorId,
        sourceIdentifier,
        currentExternalIds: [],
        normalizeMissing,
      });

      expect(second.published).toBe(0);
      expect(normalizeMissing).not.toHaveBeenCalled();
    });

    it("closes only the newly missing job when older jobs are already closed", async () => {
      const sourceIdentifier = "egress-mixed";
      await storeAndIngest(sourceIdentifier, "older-1", "Older 1");
      await storeAndIngest(sourceIdentifier, "older-2", "Older 2");
      await storeAndIngest(sourceIdentifier, "older-3", "Older 3");
      await reconcileMissingRecords({
        collectorId,
        sourceIdentifier,
        currentExternalIds: [],
        normalizeMissing: closeFromPayload,
      });

      await storeAndIngest(sourceIdentifier, "newly-gone", "Newly gone");
      const normalizeMissing = vi.fn(closeFromPayload);
      const result = await reconcileMissingRecords({
        collectorId,
        sourceIdentifier,
        currentExternalIds: [],
        normalizeMissing,
      });

      expect(result).toEqual({ processed: 4, published: 1, skipped: 0 });
      expect(normalizeMissing).toHaveBeenCalledTimes(1);
      expect(normalizeMissing).toHaveBeenCalledWith(
        expect.objectContaining({ externalId: "newly-gone" }),
      );
    });

    it("closes using the latest stored version's payload when a job has several versions", async () => {
      const sourceIdentifier = "egress-versions";
      await storeAndIngest(sourceIdentifier, "multi", "Version 1");
      await storeAndIngest(sourceIdentifier, "multi", "Version 2");
      await storeAndIngest(sourceIdentifier, "multi", "Version 3");

      const normalizeMissing = vi.fn(closeFromPayload);
      await reconcileMissingRecords({
        collectorId,
        sourceIdentifier,
        currentExternalIds: [],
        normalizeMissing,
      });

      expect(normalizeMissing).toHaveBeenCalledTimes(1);
      expect(normalizeMissing).toHaveBeenCalledWith({
        externalId: "multi",
        lastKnownPayload: { title: "Version 3" },
      });
    });

    it("closes a job again when it reappears with changed content and then disappears", async () => {
      const sourceIdentifier = "egress-reopen";
      await storeAndIngest(sourceIdentifier, "flap", "First posting");
      await reconcileMissingRecords({
        collectorId,
        sourceIdentifier,
        currentExternalIds: [],
        normalizeMissing: closeFromPayload,
      });

      await storeAndIngest(sourceIdentifier, "flap", "Second posting");
      const whileOpen = await reconcileMissingRecords({
        collectorId,
        sourceIdentifier,
        currentExternalIds: ["flap"],
        normalizeMissing: closeFromPayload,
      });
      expect(whileOpen.published).toBe(0);

      const gone = await reconcileMissingRecords({
        collectorId,
        sourceIdentifier,
        currentExternalIds: [],
        normalizeMissing: closeFromPayload,
      });
      expect(gone.published).toBe(1);

      const closedTitles = (await replayEvents({ type: TestClosed.name, collectorId })).map(
        (event) => (event.metadata as { title: string }).title,
      );
      expect(closedTitles).toContain("First posting");
      expect(closedTitles).toContain("Second posting");
    });
  });
});
