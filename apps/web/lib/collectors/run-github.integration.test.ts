import { getDb, schema } from "@web3-hunter/db";
import { createTestDatabase, type TestDatabase } from "@web3-hunter/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { runGithubCollector, type TrackedGithubOrg } from "./run-github";

interface MockRepo {
  id: number;
  name: string;
  full_name: string;
  html_url: string;
  description: string | null;
  language: string | null;
  topics: string[];
  archived: boolean;
  fork: boolean;
  license: { key: string } | null;
  stargazers_count: number;
  pushed_at: string;
  updated_at: string;
}

const orgs = new Map<string, MockRepo[] | "error">();

function repo(overrides: Partial<MockRepo> = {}): MockRepo {
  return {
    id: 1,
    name: "protocol-node",
    full_name: "acme/protocol-node",
    html_url: "https://github.com/acme/protocol-node",
    description: null,
    language: "Rust",
    topics: [],
    archived: false,
    fork: false,
    license: { key: "mit" },
    stargazers_count: 10,
    pushed_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function stubFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL) => {
      const url = String(input);
      const org = url.split("/orgs/")[1]?.split("/repos")[0];
      const repos = org ? orgs.get(org) : undefined;

      if (repos === "error" || repos === undefined) {
        return { ok: false, status: 500, statusText: "Internal Server Error" } as Response;
      }

      return { ok: true, status: 200, statusText: "OK", json: async () => repos } as Response;
    }),
  );
}

const ACME: TrackedGithubOrg = { companySlug: "acme", companyName: "Acme", org: "acme" };
const BROKEN: TrackedGithubOrg = { companySlug: "broken", companyName: "Broken Co", org: "broken" };

describe("runGithubCollector (integration)", () => {
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

  it("publishes RepositoryDiscovered for every repo on first poll and records Collector Health", async () => {
    orgs.set("acme", [repo({ id: 1 }), repo({ id: 2, name: "sdk", language: "TypeScript" })]);
    stubFetch();

    const [result] = await runGithubCollector([ACME]);

    expect(result).toMatchObject({ status: "ok", fetched: 2, published: 2 });

    const [collectorRow] = await getDb()
      .select()
      .from(schema.collector)
      .where(eq(schema.collector.slug, "github"));
    expect(collectorRow?.status).toBe("active");
    expect(collectorRow?.sourceType).toBe("vcs");
    expect(collectorRow?.lastRunAt).not.toBeNull();
    expect(collectorRow?.lastRunRecordsProcessed).toBe(2);
    expect(collectorRow?.lastRunRecordsPublished).toBe(2);
  });

  it("resolves the same Company via company_source_identity on a re-poll, publishing nothing new", async () => {
    stubFetch();

    const [result] = await runGithubCollector([ACME]);

    // Byte-identical repos are already recorded in `raw_record_ingestion`
    // from the prior poll's run, so `runIngestionPipeline` doesn't even
    // attempt to reprocess them — `skipped` (meaning "reprocessed but
    // produced nothing new") stays 0, the same as
    // `run-greenhouse.integration.test.ts`'s equivalent re-poll case.
    expect(result).toMatchObject({ status: "ok", fetched: 2, published: 0 });

    const identities = await getDb()
      .select()
      .from(schema.companySourceIdentity)
      .where(eq(schema.companySourceIdentity.sourceIdentifier, "acme"));
    expect(identities).toHaveLength(1);
  });

  it("publishes RepositoryUpdated when a field changes", async () => {
    orgs.set("acme", [
      repo({ id: 1, archived: true }),
      repo({ id: 2, name: "sdk", language: "TypeScript" }),
    ]);
    stubFetch();

    const [result] = await runGithubCollector([ACME]);

    expect(result).toMatchObject({ status: "ok", published: 1 });
  });

  it("records a fetch failure without aborting the run for other orgs", async () => {
    orgs.set("broken", "error");
    orgs.set("acme", [repo({ id: 1 })]);
    stubFetch();

    const results = await runGithubCollector([BROKEN, ACME]);

    expect(results[0]).toMatchObject({ companySlug: "broken", status: "error" });
    expect(results[1]).toMatchObject({ companySlug: "acme", status: "ok" });

    const [collectorRow] = await getDb()
      .select()
      .from(schema.collector)
      .where(eq(schema.collector.slug, "github"));
    expect(collectorRow?.status).toBe("degraded");
    expect(collectorRow?.lastErrorMessage).toMatch(/500/);
  });
});
