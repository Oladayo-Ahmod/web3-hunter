import { getDb, schema } from "@web3-hunter/db";
import { createTestDatabase, type TestDatabase } from "@web3-hunter/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { runGreenhouseCollector, type GreenhouseTrackedCompany } from "./run-greenhouse";

interface MockJob {
  id: number;
  title: string;
  updated_at: string;
  absolute_url: string;
  location: { name: string };
}

const boards = new Map<string, MockJob[] | "error">();

function stubFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL) => {
      const url = String(input);
      const boardToken = url.split("/boards/")[1]?.split("/jobs")[0];
      const jobs = boardToken ? boards.get(boardToken) : undefined;

      if (jobs === "error" || jobs === undefined) {
        return { ok: false, status: 500, statusText: "Internal Server Error" } as Response;
      }

      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({ jobs }),
      } as Response;
    }),
  );
}

const ACME: GreenhouseTrackedCompany = {
  companySlug: "acme",
  companyName: "Acme",
  boardToken: "acme",
};
const BROKEN: GreenhouseTrackedCompany = {
  companySlug: "broken",
  companyName: "Broken Co",
  boardToken: "broken",
};

describe("runGreenhouseCollector (integration)", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    process.env.DATABASE_URL = testDb.connectionString;
  }, 60_000);

  afterAll(async () => {
    await testDb.stop();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("publishes JobPosted for every open role on first poll", async () => {
    boards.set("acme", [
      {
        id: 1,
        title: "Protocol Engineer",
        updated_at: "2026-01-01T00:00:00-00:00",
        absolute_url: "https://acme.example/jobs/1",
        location: { name: "Remote" },
      },
      {
        id: 2,
        title: "Security Researcher",
        updated_at: "2026-01-01T00:00:00-00:00",
        absolute_url: "https://acme.example/jobs/2",
        location: { name: "Remote" },
      },
    ]);
    stubFetch();

    const [result] = await runGreenhouseCollector([ACME]);

    expect(result).toMatchObject({ status: "ok", fetched: 2, published: 2, closed: 0 });

    const [collectorRow] = await getDb()
      .select()
      .from(schema.collector)
      .where(eq(schema.collector.slug, "greenhouse"));
    expect(collectorRow?.status).toBe("active");
    expect(collectorRow?.lastRunAt).not.toBeNull();
  });

  it("publishes nothing on a re-poll with no changes", async () => {
    stubFetch();

    const [result] = await runGreenhouseCollector([ACME]);

    expect(result).toMatchObject({ status: "ok", fetched: 2, published: 0, closed: 0 });
  });

  it("publishes JobUpdated, not a duplicate JobPosted, when a field changes", async () => {
    boards.set("acme", [
      {
        id: 1,
        title: "Senior Protocol Engineer",
        updated_at: "2026-01-02T00:00:00-00:00",
        absolute_url: "https://acme.example/jobs/1",
        location: { name: "Remote" },
      },
      {
        id: 2,
        title: "Security Researcher",
        updated_at: "2026-01-01T00:00:00-00:00",
        absolute_url: "https://acme.example/jobs/2",
        location: { name: "Remote" },
      },
    ]);
    stubFetch();

    const [result] = await runGreenhouseCollector([ACME]);

    expect(result).toMatchObject({ status: "ok", published: 1, closed: 0 });
  });

  it("publishes JobClosed when a previously-open role disappears from the poll", async () => {
    boards.set("acme", [
      {
        id: 2,
        title: "Security Researcher",
        updated_at: "2026-01-01T00:00:00-00:00",
        absolute_url: "https://acme.example/jobs/2",
        location: { name: "Remote" },
      },
    ]);
    stubFetch();

    const [result] = await runGreenhouseCollector([ACME]);

    expect(result).toMatchObject({ status: "ok", fetched: 1, closed: 1 });
  });

  it("records a fetch failure without aborting the run for other companies", async () => {
    boards.set("broken", "error");
    boards.set("acme", [
      {
        id: 2,
        title: "Security Researcher",
        updated_at: "2026-01-01T00:00:00-00:00",
        absolute_url: "https://acme.example/jobs/2",
        location: { name: "Remote" },
      },
    ]);
    stubFetch();

    const results = await runGreenhouseCollector([BROKEN, ACME]);

    expect(results[0]).toMatchObject({ companySlug: "broken", status: "error" });
    expect(results[1]).toMatchObject({ companySlug: "acme", status: "ok" });

    const [collectorRow] = await getDb()
      .select()
      .from(schema.collector)
      .where(eq(schema.collector.slug, "greenhouse"));
    expect(collectorRow?.lastErrorMessage).toMatch(/500/);
  });
});
