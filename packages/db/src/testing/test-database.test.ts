import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { collector, event, rawRecord } from "../schema";
import { createTestDatabase, type TestDatabase } from "./test-database";

describe("createTestDatabase", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    testDb = await createTestDatabase();
  }, 60_000);

  afterAll(async () => {
    await testDb.stop();
  });

  it("applies every migration, including the append-only enforcement triggers", async () => {
    const tables = await testDb.db.execute(
      sql`select table_name from information_schema.tables where table_schema = 'public' order by table_name`,
    );

    expect(tables.map((row) => row.table_name)).toEqual([
      "collector",
      "company",
      "event",
      "event_provenance",
      "raw_record",
      "raw_record_ingestion",
      "system_health_check",
    ]);
  });

  it("allows inserting a row into the event table", async () => {
    const [inserted] = await testDb.db
      .insert(collector)
      .values({ slug: "test-collector", sourceType: "test" })
      .returning();

    expect(inserted).toBeDefined();

    const [row] = await testDb.db
      .insert(event)
      .values({
        type: "TestEvent",
        category: "source",
        version: 1,
        collectorId: inserted!.id,
        occurredAt: new Date(),
        confidence: 1,
        metadata: { hello: "world" },
      })
      .returning();

    expect(row?.type).toBe("TestEvent");
  });

  it("rejects UPDATE against the event table at the database level", async () => {
    const rows = await testDb.db.select().from(event).limit(1);
    const target = rows[0];
    expect(target).toBeDefined();

    const error: unknown = await testDb.db
      .execute(sql`update "event" set "type" = 'Mutated' where "id" = ${target!.id}`)
      .catch((caught: unknown) => caught);

    expect(String((error as { cause?: unknown }).cause ?? error)).toMatch(/append-only/i);
  });

  it("rejects DELETE against the event table at the database level", async () => {
    const rows = await testDb.db.select().from(event).limit(1);
    const target = rows[0];
    expect(target).toBeDefined();

    const error: unknown = await testDb.db
      .execute(sql`delete from "event" where "id" = ${target!.id}`)
      .catch((caught: unknown) => caught);

    expect(String((error as { cause?: unknown }).cause ?? error)).toMatch(/append-only/i);
  });

  it("rejects UPDATE and DELETE against the raw_record table at the database level", async () => {
    const [inserted] = await testDb.db
      .insert(collector)
      .values({ slug: "raw-record-test-collector", sourceType: "test" })
      .returning();

    const [row] = await testDb.db
      .insert(rawRecord)
      .values({ collectorId: inserted!.id, contentHash: "abc123", payload: { hello: "world" } })
      .returning();

    const updateError: unknown = await testDb.db
      .execute(sql`update "raw_record" set "content_hash" = 'mutated' where "id" = ${row!.id}`)
      .catch((caught: unknown) => caught);
    expect(String((updateError as { cause?: unknown }).cause ?? updateError)).toMatch(
      /append-only/i,
    );

    const deleteError: unknown = await testDb.db
      .execute(sql`delete from "raw_record" where "id" = ${row!.id}`)
      .catch((caught: unknown) => caught);
    expect(String((deleteError as { cause?: unknown }).cause ?? deleteError)).toMatch(
      /append-only/i,
    );
  });
});
