import { getDb, schema } from "@web3-hunter/db";
import { createTestDatabase, type TestDatabase } from "@web3-hunter/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { runDefiLlamaCollector } from "./run-defillama";

interface MockProtocol {
  name: string;
  slug: string;
  category?: string | null;
  tvl?: number | null;
  change_1d?: number | null;
  change_7d?: number | null;
  listedAt?: number | null;
  audits?: string | null;
  audit_links?: string[] | null;
  chains?: string[];
}

let protocols: MockProtocol[] | "error" = [];

function protocol(overrides: Partial<MockProtocol> = {}): MockProtocol {
  return {
    name: "Acme Protocol",
    slug: "acme-protocol",
    category: "Lending",
    tvl: 10_000_000,
    chains: ["Ethereum"],
    ...overrides,
  };
}

function stubFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      if (protocols === "error") {
        return { ok: false, status: 500, statusText: "Internal Server Error" } as Response;
      }
      return { ok: true, status: 200, statusText: "OK", json: async () => protocols } as Response;
    }),
  );
}

describe("runDefiLlamaCollector (integration)", () => {
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

  it("tracks only protocols above the TVL floor, publishing ProtocolSnapshotRecorded for each", async () => {
    protocols = [
      protocol({ slug: "big-protocol", tvl: 50_000_000 }),
      protocol({ slug: "tiny-protocol", tvl: 10_000 }),
    ];
    stubFetch();

    const result = await runDefiLlamaCollector();

    expect(result).toMatchObject({ fetched: 2, tracked: 1, published: 1 });

    const target = await getDb()
      .select()
      .from(schema.securityTarget)
      .where(eq(schema.securityTarget.slug, "big-protocol"));
    expect(target).toHaveLength(1);

    const skippedTarget = await getDb()
      .select()
      .from(schema.securityTarget)
      .where(eq(schema.securityTarget.slug, "tiny-protocol"));
    expect(skippedTarget).toHaveLength(0);

    const collectorRow = await getDb()
      .select()
      .from(schema.collector)
      .where(eq(schema.collector.slug, "defillama"));
    expect(collectorRow[0]?.status).toBe("active");
    expect(collectorRow[0]?.sourceType).toBe("security-intelligence");
  });

  it("resolves the same Security Target via security_target_source_identity on a re-poll, publishing nothing new for unchanged protocols", async () => {
    stubFetch();

    const result = await runDefiLlamaCollector();

    expect(result).toMatchObject({ tracked: 1, published: 0 });

    const identities = await getDb()
      .select()
      .from(schema.securityTargetSourceIdentity)
      .where(eq(schema.securityTargetSourceIdentity.sourceIdentifier, "big-protocol"));
    expect(identities).toHaveLength(1);
  });

  it("publishes ProtocolSnapshotUpdated when a tracked protocol's TVL changes", async () => {
    protocols = [protocol({ slug: "big-protocol", tvl: 75_000_000 })];
    stubFetch();

    const result = await runDefiLlamaCollector();

    expect(result).toMatchObject({ tracked: 1, published: 1 });
  });

  it("records Collector Health as degraded when the fetch fails, without throwing an unhandled path", async () => {
    protocols = "error";
    stubFetch();

    await expect(runDefiLlamaCollector()).rejects.toThrow();

    const collectorRow = await getDb()
      .select()
      .from(schema.collector)
      .where(eq(schema.collector.slug, "defillama"));
    expect(collectorRow[0]?.status).toBe("degraded");
    expect(collectorRow[0]?.lastErrorMessage).toMatch(/500/);
  });
});
