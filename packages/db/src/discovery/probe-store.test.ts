import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { companyDiscoveryProbe } from "../schema";
import { createTestDatabase, type TestDatabase } from "../testing/test-database";
import { hasBeenProbed, recordProbe } from "./probe-store";

describe("probe-store", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    testDb = await createTestDatabase();
  }, 60_000);

  afterAll(async () => {
    await testDb.stop();
  });

  it("hasBeenProbed is false before any probe is recorded", async () => {
    expect(await hasBeenProbed(testDb.db, "unprobed-candidate", "greenhouse")).toBe(false);
  });

  it("hasBeenProbed is true after a confident miss", async () => {
    await recordProbe(testDb.db, {
      candidateName: "Miss Co",
      candidateSlug: "miss-co",
      collectorSlug: "greenhouse",
      result: "miss",
    });
    expect(await hasBeenProbed(testDb.db, "miss-co", "greenhouse")).toBe(true);
  });

  it("hasBeenProbed is true after a hit", async () => {
    await recordProbe(testDb.db, {
      candidateName: "Hit Co",
      candidateSlug: "hit-co",
      collectorSlug: "lever",
      result: "hit",
    });
    expect(await hasBeenProbed(testDb.db, "hit-co", "lever")).toBe(true);
  });

  it("hasBeenProbed remains false after only a transient error — the whole point of the error state", async () => {
    await recordProbe(testDb.db, {
      candidateName: "Flaky Co",
      candidateSlug: "flaky-co",
      collectorSlug: "ashby",
      result: "error",
    });
    expect(await hasBeenProbed(testDb.db, "flaky-co", "ashby")).toBe(false);
  });

  it("a retry after a transient error overwrites the row with the confident result, not a duplicate", async () => {
    await recordProbe(testDb.db, {
      candidateName: "Retry Co",
      candidateSlug: "retry-co",
      collectorSlug: "greenhouse",
      result: "error",
    });
    expect(await hasBeenProbed(testDb.db, "retry-co", "greenhouse")).toBe(false);

    // Simulates the retry succeeding this time.
    await recordProbe(testDb.db, {
      candidateName: "Retry Co",
      candidateSlug: "retry-co",
      collectorSlug: "greenhouse",
      result: "hit",
    });

    expect(await hasBeenProbed(testDb.db, "retry-co", "greenhouse")).toBe(true);

    const rows = await testDb.db
      .select()
      .from(companyDiscoveryProbe)
      .where(
        and(
          eq(companyDiscoveryProbe.candidateSlug, "retry-co"),
          eq(companyDiscoveryProbe.collectorSlug, "greenhouse"),
        ),
      );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.result).toBe("hit");
  });
});
