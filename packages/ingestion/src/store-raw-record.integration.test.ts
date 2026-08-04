import { getDb, schema } from "@web3-hunter/db";
import { createTestDatabase, type TestDatabase } from "@web3-hunter/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
    });

    expect(record.payload).toEqual({ id: 1, title: "Engineer" });
    expect(record.externalId).toBe("1");
  });

  it("is idempotent: storing the same payload again returns the existing row, not a duplicate", async () => {
    const first = await storeRawRecord({
      collectorId,
      payload: { id: 2, title: "Designer" },
      externalId: "2",
    });
    const second = await storeRawRecord({
      collectorId,
      payload: { id: 2, title: "Designer" },
      externalId: "2",
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
    });
    const second = await storeRawRecord({
      collectorId,
      payload: { location: "Remote", id: 3, title: "PM" },
      externalId: "3",
    });

    expect(second.id).toBe(first.id);
  });

  it("creates a new Raw Record when the payload actually changes", async () => {
    const first = await storeRawRecord({
      collectorId,
      payload: { id: 4, title: "Analyst" },
      externalId: "4",
    });
    const second = await storeRawRecord({
      collectorId,
      payload: { id: 4, title: "Senior Analyst" },
      externalId: "4",
    });

    expect(second.id).not.toBe(first.id);
  });
});
