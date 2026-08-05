import { createTestDatabase, type TestDatabase } from "@web3-hunter/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listPipelineRuns } from "./pipeline-run-query-service";
import { seedPipelineRun } from "./test-support/seed";

describe("pipeline-run-query-service (integration)", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    process.env.DATABASE_URL = testDb.connectionString;
  }, 60_000);

  afterAll(async () => {
    await testDb.stop();
  });

  it("returns an empty list when nothing has run yet", async () => {
    const runs = await listPipelineRuns({ pipelineName: "does-not-exist-pipeline" });
    expect(runs).toEqual([]);
  });

  it("maps a succeeded run's fields, including metrics, into the DTO shape", async () => {
    const scopeId = crypto.randomUUID();
    await seedPipelineRun({
      pipelineName: "scoring-dto-test",
      scopeType: "company",
      scopeId,
      status: "succeeded",
      metrics: { eventsProcessed: 4, signalsProduced: 2 },
    });

    const runs = await listPipelineRuns({ pipelineName: "scoring-dto-test" });

    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      pipelineName: "scoring-dto-test",
      scopeType: "company",
      scopeId,
      status: "succeeded",
      metrics: { eventsProcessed: 4, signalsProduced: 2 },
      errorMessage: null,
    });
    expect(typeof runs[0]?.startedAt).toBe("string");
    expect(typeof runs[0]?.completedAt).toBe("string");
  });

  it("maps a failed run's errorMessage, with null metrics", async () => {
    const scopeId = crypto.randomUUID();
    await seedPipelineRun({
      pipelineName: "matching-dto-test",
      scopeType: "user",
      scopeId,
      status: "failed",
      errorMessage: "database connection lost",
    });

    const runs = await listPipelineRuns({ pipelineName: "matching-dto-test" });

    expect(runs[0]).toMatchObject({
      status: "failed",
      metrics: null,
      errorMessage: "database connection lost",
    });
  });

  it("filters by pipelineName", async () => {
    const scopeId = crypto.randomUUID();
    await seedPipelineRun({ pipelineName: "filter-test-a", scopeType: "company", scopeId });
    await seedPipelineRun({ pipelineName: "filter-test-b", scopeType: "company", scopeId });

    const runs = await listPipelineRuns({ pipelineName: "filter-test-a" });

    expect(runs.every((run) => run.pipelineName === "filter-test-a")).toBe(true);
  });

  it("orders most-recently-recorded first, regardless of insertion order", async () => {
    const scopeId = crypto.randomUUID();
    const older = new Date("2026-01-01T00:00:00Z");
    const newer = new Date("2026-01-02T00:00:00Z");

    // Inserted in reverse chronological order on purpose, to prove the
    // ordering comes from `recordedAt`, not from insertion sequence.
    await seedPipelineRun({
      pipelineName: "order-test",
      scopeType: "company",
      scopeId,
      recordedAt: newer,
      metrics: { label: "newer" },
    });
    await seedPipelineRun({
      pipelineName: "order-test",
      scopeType: "company",
      scopeId,
      recordedAt: older,
      metrics: { label: "older" },
    });

    const runs = await listPipelineRuns({ pipelineName: "order-test" });

    expect(runs).toHaveLength(2);
    expect(runs[0]?.metrics).toEqual({ label: "newer" });
    expect(runs[1]?.metrics).toEqual({ label: "older" });
  });

  it("respects the limit parameter, capped at the maximum", async () => {
    const scopeId = crypto.randomUUID();
    for (let i = 0; i < 5; i += 1) {
      await seedPipelineRun({ pipelineName: "limit-test", scopeType: "company", scopeId });
    }

    const runs = await listPipelineRuns({ pipelineName: "limit-test", limit: 2 });

    expect(runs).toHaveLength(2);
  });
});
