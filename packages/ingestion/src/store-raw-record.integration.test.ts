import { getDb, schema } from "@web3-hunter/db";
import { createTestDatabase, type TestDatabase } from "@web3-hunter/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashContent } from "./content-hash";
import { storeRawRecord, storeRawRecords } from "./store-raw-record";

// One shared test database for the whole file — `getDb()` caches its
// connection pool as a module-level singleton on first use (see
// packages/db/src/client.ts), so a second `createTestDatabase()` call
// later in the same process would be invisible to it.
let testDb: TestDatabase;

beforeAll(async () => {
  testDb = await createTestDatabase();
  process.env.DATABASE_URL = testDb.connectionString;
}, 60_000);

afterAll(async () => {
  await testDb.stop();
});

describe("storeRawRecord (integration)", () => {
  let collectorId: string;

  beforeAll(async () => {
    const [row] = await getDb()
      .insert(schema.collector)
      .values({ slug: "test-collector", sourceType: "test" })
      .returning();
    collectorId = row!.id;
  });

  it("persists a new Raw Record", async () => {
    const record = await storeRawRecord({
      collectorId,
      payload: { id: 1, title: "Engineer" },
      externalId: "1",
      sourceIdentifier: "test-source",
    });

    expect(record.payload).toEqual({ id: 1, title: "Engineer" });
    expect(record.externalId).toBe("1");
  });

  it("is idempotent: storing the same payload again returns the existing row, not a duplicate", async () => {
    const first = await storeRawRecord({
      collectorId,
      payload: { id: 2, title: "Designer" },
      externalId: "2",
      sourceIdentifier: "test-source",
    });
    const second = await storeRawRecord({
      collectorId,
      payload: { id: 2, title: "Designer" },
      externalId: "2",
      sourceIdentifier: "test-source",
    });

    expect(second.id).toBe(first.id);

    const rows = await getDb().select().from(schema.rawRecord);
    const matching = rows.filter((row) => row.externalId === "2");
    expect(matching).toHaveLength(1);
  });

  it("treats key order as irrelevant when deduplicating", async () => {
    const first = await storeRawRecord({
      collectorId,
      payload: { id: 3, title: "PM", location: "Remote" },
      externalId: "3",
      sourceIdentifier: "test-source",
    });
    const second = await storeRawRecord({
      collectorId,
      payload: { location: "Remote", id: 3, title: "PM" },
      externalId: "3",
      sourceIdentifier: "test-source",
    });

    expect(second.id).toBe(first.id);
  });

  it("creates a new Raw Record when the payload actually changes", async () => {
    const first = await storeRawRecord({
      collectorId,
      payload: { id: 4, title: "Analyst" },
      externalId: "4",
      sourceIdentifier: "test-source",
    });
    const second = await storeRawRecord({
      collectorId,
      payload: { id: 4, title: "Senior Analyst" },
      externalId: "4",
      sourceIdentifier: "test-source",
    });

    expect(second.id).not.toBe(first.id);
  });

  // Regression test for a real production failure: a Raw Record captured
  // before source_identifier existed (sourceIdentifier: null) whose
  // content is unchanged must not block every future collector run for
  // that entity - it should be returned silently, exactly like any other
  // dedup hit, not treated as a collision.
  it("does not throw when the existing row is a pre-migration legacy record (NULL sourceIdentifier) with matching content", async () => {
    const legacyPayload = { id: 5, title: "Pre-migration role" };
    const [legacyRow] = await getDb()
      .insert(schema.rawRecord)
      .values({
        collectorId,
        // Must be the real hash of the payload below, not an arbitrary
        // string — this is exactly what makes storeRawRecord's dedup
        // conflict path trigger against it.
        contentHash: hashContent(legacyPayload),
        externalId: "legacy-5",
        sourceIdentifier: null,
        payload: legacyPayload,
      })
      .returning();

    const result = await storeRawRecord({
      collectorId,
      payload: legacyPayload,
      externalId: "legacy-5",
      sourceIdentifier: "real-source",
    });

    expect(result.id).toBe(legacyRow!.id);
    expect(result.sourceIdentifier).toBeNull();

    // The legacy row itself must remain untouched - append-only, and this
    // call must not have attempted (or needed) to change it.
    const [stillLegacy] = await getDb()
      .select()
      .from(schema.rawRecord)
      .where(eq(schema.rawRecord.id, legacyRow!.id));
    expect(stillLegacy?.sourceIdentifier).toBeNull();
  });

  // The check this is defending must still actually catch the case it
  // exists for: two different, real sourceIdentifiers producing
  // byte-identical content is exactly the "structurally impossible"
  // scenario ADR 0002 documents - if it ever happens, this must fail
  // loudly, not silently attribute the record to the wrong source.
  it("throws when the existing row has a different, non-null sourceIdentifier", async () => {
    await storeRawRecord({
      collectorId,
      payload: { id: 6, title: "Collision role" },
      externalId: "collision-6",
      sourceIdentifier: "source-one",
    });

    await expect(
      storeRawRecord({
        collectorId,
        payload: { id: 6, title: "Collision role" },
        externalId: "collision-6",
        sourceIdentifier: "source-two",
      }),
    ).rejects.toThrow(/different sourceIdentifier/);
  });
});

/**
 * Milestone 25 — `storeRawRecords` is the batched sibling of the tests
 * above: same guarantees (content-hash dedup, cross-source-collision
 * defense-in-depth, key-order irrelevance), just in bounded round trips.
 * These tests exist to prove batching didn't quietly change what gets
 * persisted or how many rows result — only how many round trips it took.
 */
describe("storeRawRecords (integration)", () => {
  let collectorId: string;

  beforeAll(async () => {
    const [row] = await getDb()
      .insert(schema.collector)
      .values({ slug: "test-batch-collector", sourceType: "test" })
      .returning();
    collectorId = row!.id;
  });

  it("returns [] without touching the database for an empty batch", async () => {
    const result = await storeRawRecords([]);
    expect(result).toEqual([]);
  });

  it("persists every new record in a batch, in input order", async () => {
    const results = await storeRawRecords([
      { collectorId, payload: { id: "b1" }, externalId: "b1", sourceIdentifier: "batch-source" },
      { collectorId, payload: { id: "b2" }, externalId: "b2", sourceIdentifier: "batch-source" },
      { collectorId, payload: { id: "b3" }, externalId: "b3", sourceIdentifier: "batch-source" },
    ]);

    expect(results.map((r) => r.externalId)).toEqual(["b1", "b2", "b3"]);
  });

  it("is idempotent at batch scale: re-storing the same batch returns the same rows, creates no duplicates", async () => {
    const input = [
      { collectorId, payload: { id: "c1" }, externalId: "c1", sourceIdentifier: "batch-source" },
      { collectorId, payload: { id: "c2" }, externalId: "c2", sourceIdentifier: "batch-source" },
    ];

    const first = await storeRawRecords(input);
    const second = await storeRawRecords(input);

    expect(second.map((r) => r.id)).toEqual(first.map((r) => r.id));

    const rows = await getDb().select().from(schema.rawRecord);
    expect(rows.filter((r) => r.externalId === "c1")).toHaveLength(1);
    expect(rows.filter((r) => r.externalId === "c2")).toHaveLength(1);
  });

  it("dedupes an in-batch duplicate payload against itself within one call", async () => {
    const results = await storeRawRecords([
      {
        collectorId,
        payload: { id: "dup", title: "Same" },
        externalId: "dup",
        sourceIdentifier: "batch-source",
      },
      {
        collectorId,
        payload: { id: "dup", title: "Same" },
        externalId: "dup",
        sourceIdentifier: "batch-source",
      },
    ]);

    expect(results[0]!.id).toBe(results[1]!.id);
    const rows = await getDb().select().from(schema.rawRecord);
    expect(rows.filter((r) => r.externalId === "dup")).toHaveLength(1);
  });

  it("handles a mixed batch: some records new, some already existing", async () => {
    const existing = await storeRawRecord({
      collectorId,
      payload: { id: "mix-1" },
      externalId: "mix-1",
      sourceIdentifier: "batch-source",
    });

    const results = await storeRawRecords([
      {
        collectorId,
        payload: { id: "mix-1" },
        externalId: "mix-1",
        sourceIdentifier: "batch-source",
      },
      {
        collectorId,
        payload: { id: "mix-2" },
        externalId: "mix-2",
        sourceIdentifier: "batch-source",
      },
    ]);

    expect(results[0]!.id).toBe(existing.id);
    expect(results[1]!.externalId).toBe("mix-2");
  });

  it("returns identity-only references, never the stored payload — new and already-existing alike", async () => {
    const input = [
      {
        collectorId,
        payload: { id: "slim-1", description: "x".repeat(2000) },
        externalId: "slim-1",
        sourceIdentifier: "batch-source",
      },
    ];

    const [inserted] = await storeRawRecords(input);
    const [existing] = await storeRawRecords(input);

    expect(inserted).not.toHaveProperty("payload");
    expect(existing).not.toHaveProperty("payload");
    expect(existing!.id).toBe(inserted!.id);
    expect(existing).toMatchObject({ externalId: "slim-1", sourceIdentifier: "batch-source" });
  });

  it("throws on a mixed-collectorId batch rather than silently misattributing rows", async () => {
    const [otherCollector] = await getDb()
      .insert(schema.collector)
      .values({ slug: "test-batch-collector-2", sourceType: "test" })
      .returning();

    await expect(
      storeRawRecords([
        { collectorId, payload: { id: "x1" }, externalId: "x1", sourceIdentifier: "batch-source" },
        {
          collectorId: otherCollector!.id,
          payload: { id: "x2" },
          externalId: "x2",
          sourceIdentifier: "batch-source",
        },
      ]),
    ).rejects.toThrow(/mixed batch/);
  });

  it("throws the same cross-source-collision error as the single-record path", async () => {
    await storeRawRecords([
      {
        collectorId,
        payload: { id: "collision-batch" },
        externalId: "collision-batch",
        sourceIdentifier: "source-one",
      },
    ]);

    await expect(
      storeRawRecords([
        {
          collectorId,
          payload: { id: "collision-batch" },
          externalId: "collision-batch",
          sourceIdentifier: "source-two",
        },
      ]),
    ).rejects.toThrow(/different sourceIdentifier/);
  });
});
