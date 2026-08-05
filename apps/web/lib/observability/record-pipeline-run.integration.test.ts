import { getDb, schema } from "@web3-hunter/db";
import { createTestDatabase, type TestDatabase } from "@web3-hunter/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { recordPipelineRun } from "./record-pipeline-run";

describe("recordPipelineRun (integration)", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    process.env.DATABASE_URL = testDb.connectionString;
  }, 60_000);

  afterAll(async () => {
    await testDb.stop();
  });

  it("records a succeeded run with the wrapped function's result as metrics, and returns that result unchanged", async () => {
    const scopeId = crypto.randomUUID();

    const result = await recordPipelineRun(
      { pipelineName: "scoring", scopeType: "company", scopeId },
      async () => ({ eventsProcessed: 3, signalsProduced: 2 }),
    );

    expect(result).toEqual({ eventsProcessed: 3, signalsProduced: 2 });

    const [row] = await getDb()
      .select()
      .from(schema.pipelineRun)
      .where(eq(schema.pipelineRun.scopeId, scopeId));

    expect(row).toBeDefined();
    expect(row?.pipelineName).toBe("scoring");
    expect(row?.scopeType).toBe("company");
    expect(row?.status).toBe("succeeded");
    expect(row?.metrics).toEqual({ eventsProcessed: 3, signalsProduced: 2 });
    expect(row?.errorMessage).toBeNull();
    expect(row?.durationMs).toBeGreaterThanOrEqual(0);
    expect(row!.completedAt.getTime()).toBeGreaterThanOrEqual(row!.startedAt.getTime());
  });

  it("records a failed run with the error message, and re-throws the original error", async () => {
    const scopeId = crypto.randomUUID();

    await expect(
      recordPipelineRun({ pipelineName: "matching", scopeType: "user", scopeId }, async () => {
        throw new Error("boom: something went wrong");
      }),
    ).rejects.toThrow("boom: something went wrong");

    const [row] = await getDb()
      .select()
      .from(schema.pipelineRun)
      .where(eq(schema.pipelineRun.scopeId, scopeId));

    expect(row).toBeDefined();
    expect(row?.pipelineName).toBe("matching");
    expect(row?.scopeType).toBe("user");
    expect(row?.status).toBe("failed");
    expect(row?.metrics).toBeNull();
    expect(row?.errorMessage).toBe("boom: something went wrong");
  });

  it("preserves a non-Error thrown value's string representation", async () => {
    const scopeId = crypto.randomUUID();

    await expect(
      recordPipelineRun({ pipelineName: "decision", scopeType: "user", scopeId }, () =>
        Promise.reject("a plain string rejection"),
      ),
    ).rejects.toBe("a plain string rejection");

    const [row] = await getDb()
      .select()
      .from(schema.pipelineRun)
      .where(eq(schema.pipelineRun.scopeId, scopeId));

    expect(row?.errorMessage).toBe("a plain string rejection");
  });

  it("records one row per invocation — a log, not a per-scope snapshot", async () => {
    const scopeId = crypto.randomUUID();

    await recordPipelineRun(
      { pipelineName: "technology", scopeType: "company", scopeId },
      async () => ({
        detectionsProduced: 1,
      }),
    );
    await recordPipelineRun(
      { pipelineName: "technology", scopeType: "company", scopeId },
      async () => ({
        detectionsProduced: 0,
      }),
    );

    const rows = await getDb()
      .select()
      .from(schema.pipelineRun)
      .where(eq(schema.pipelineRun.scopeId, scopeId));

    expect(rows).toHaveLength(2);
  });
});
