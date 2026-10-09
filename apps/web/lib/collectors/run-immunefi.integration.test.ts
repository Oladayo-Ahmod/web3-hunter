import { getDb, schema } from "@web3-hunter/db";
import { createTestDatabase, type TestDatabase } from "@web3-hunter/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { runImmunefiCollector } from "./run-immunefi";

interface MockBounty {
  slug: string;
  project: string;
  ecosystem: string[];
  launchDate: string;
  updatedDate: string;
  isPaused: boolean;
  pausedAt: string | null;
  maxBounty: number;
  rewardsPool: number;
  githubUrl: string | null;
  websiteUrl: string | null;
  kyc: boolean;
  inviteOnly: boolean;
  assets: { id: string; type: string; description: string | null; url: string | null }[];
}

let bounties: MockBounty[] | "error" = [];

function bounty(overrides: Partial<MockBounty> = {}): MockBounty {
  return {
    slug: "acme-protocol",
    project: "Acme Protocol",
    ecosystem: ["ETH"],
    launchDate: "2020-01-01T00:00:00.000Z",
    updatedDate: "2026-01-01T00:00:00.000Z",
    isPaused: false,
    pausedAt: null,
    maxBounty: 100_000,
    rewardsPool: 0,
    githubUrl: "https://github.com/acme/acme-protocol",
    websiteUrl: null,
    kyc: false,
    inviteOnly: false,
    assets: [{ id: "asset-1", type: "smart_contract", description: "A", url: null }],
    ...overrides,
  };
}

function stubFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      if (bounties === "error") {
        return { ok: false, status: 500, statusText: "Internal Server Error" } as Response;
      }
      return { ok: true, status: 200, statusText: "OK", json: async () => bounties } as Response;
    }),
  );
}

describe("runImmunefiCollector (integration)", () => {
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

  it("tracks every program, publishing BountyProgramRecorded and upserting a Bug Bounty row", async () => {
    bounties = [bounty()];
    stubFetch();

    const result = await runImmunefiCollector();

    expect(result).toMatchObject({ fetched: 1, published: 1, collisions: [] });

    const target = await getDb()
      .select()
      .from(schema.securityTarget)
      .where(eq(schema.securityTarget.slug, "acme-protocol"));
    expect(target).toHaveLength(1);

    const bugBounty = await getDb()
      .select()
      .from(schema.bugBounty)
      .where(eq(schema.bugBounty.securityTargetId, target[0]!.id));
    expect(bugBounty).toHaveLength(1);
    expect(bugBounty[0]).toMatchObject({
      platform: "immunefi",
      status: "active",
      maxRewardAmount: "100000",
    });

    const collectorRow = await getDb()
      .select()
      .from(schema.collector)
      .where(eq(schema.collector.slug, "immunefi"));
    expect(collectorRow[0]?.status).toBe("active");
    expect(collectorRow[0]?.sourceType).toBe("security-intelligence");
  });

  it("resolves the same Security Target via security_target_source_identity on a re-poll, publishing nothing new for an unchanged program", async () => {
    stubFetch();

    const result = await runImmunefiCollector();

    expect(result).toMatchObject({ fetched: 1, published: 0 });

    const identities = await getDb()
      .select()
      .from(schema.securityTargetSourceIdentity)
      .where(eq(schema.securityTargetSourceIdentity.sourceIdentifier, "acme-protocol"));
    expect(identities).toHaveLength(1);
  });

  it("upserts the Bug Bounty row idempotently when a program's status changes (paused)", async () => {
    bounties = [
      bounty({
        isPaused: true,
        pausedAt: "2026-01-02T00:00:00.000Z",
        updatedDate: "2026-01-02T00:00:00.000Z",
      }),
    ];
    stubFetch();

    await runImmunefiCollector();

    const target = await getDb()
      .select()
      .from(schema.securityTarget)
      .where(eq(schema.securityTarget.slug, "acme-protocol"));
    const bugBountyRows = await getDb()
      .select()
      .from(schema.bugBounty)
      .where(eq(schema.bugBounty.securityTargetId, target[0]!.id));
    expect(bugBountyRows).toHaveLength(1);
    expect(bugBountyRows[0]?.status).toBe("paused");
  });

  it("surfaces an identity collision without aborting the rest of the run", async () => {
    // "acme-protocol" already resolved above with repositoryUrl
    // "https://github.com/acme/acme-protocol" under the immunefi
    // Collector's own identity — simulate a genuinely ambiguous
    // collision via a *different* slug whose Security Target already
    // exists (created directly, no repositoryUrl) under a *different*
    // Collector.
    await getDb().insert(schema.collector).values({ slug: "other-source", sourceType: "test" });
    const [otherCollector] = await getDb()
      .select()
      .from(schema.collector)
      .where(eq(schema.collector.slug, "other-source"));
    const [ambiguousTarget] = await getDb()
      .insert(schema.securityTarget)
      .values({ slug: "ambiguous-protocol", name: "Ambiguous Protocol" })
      .returning();
    await getDb().insert(schema.securityTargetSourceIdentity).values({
      collectorId: otherCollector!.id,
      sourceIdentifier: "ambiguous-protocol",
      securityTargetId: ambiguousTarget!.id,
    });

    bounties = [
      bounty({ slug: "ambiguous-protocol", project: "Ambiguous Protocol (Immunefi)" }),
      bounty({ slug: "second-protocol", project: "Second Protocol" }),
    ];
    stubFetch();

    const result = await runImmunefiCollector();

    expect(result.collisions).toHaveLength(1);
    expect(result.collisions[0]?.slug).toBe("ambiguous-protocol");
    // The other program in the same run still processes normally.
    const secondTarget = await getDb()
      .select()
      .from(schema.securityTarget)
      .where(eq(schema.securityTarget.slug, "second-protocol"));
    expect(secondTarget).toHaveLength(1);
  });

  it("records a fetch failure as a degraded Collector without throwing an unhandled path", async () => {
    bounties = "error";
    stubFetch();

    await expect(runImmunefiCollector()).rejects.toThrow();

    const collectorRow = await getDb()
      .select()
      .from(schema.collector)
      .where(eq(schema.collector.slug, "immunefi"));
    expect(collectorRow[0]?.status).toBe("degraded");
    expect(collectorRow[0]?.lastErrorMessage).toMatch(/500/);
  });
});
