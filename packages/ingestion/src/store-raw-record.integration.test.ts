import { getDb, schema } from "@web3-hunter/db";
import { createTestDatabase, type TestDatabase } from "@web3-hunter/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashContent } from "./content-hash";
import { storeRawRecord } from "./store-raw-record";

describe("storeRawRecord (integration)", () => {
  let testDb: TestDatabase;
  let collectorId: string;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    process.env.DATABASE_URL = testDb.connectionString;

    const [row] = await getDb()
      .insert(schema.collector)
      .values({ slug: "test-collector", sourceType: "test" })
      .returning();
    collectorId = row!.id;
  }, 60_000);

  afterAll(async () => {
    await testDb.stop();
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
