import { getDb, resolveOrCreateCollector, schema } from "@web3-hunter/db";
import { createTestDatabase, type TestDatabase } from "@web3-hunter/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { runImmunefiCollector } from "./run-immunefi";

/** Idempotently resolves the one real "defillama" Collector row every identity-repair test shares — `collector.slug` is unique, so these tests cannot each create their own. */
async function defiLlamaCollectorId(): Promise<string> {
  return resolveOrCreateCollector(getDb(), "defillama", "security-intelligence");
}

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

  it("reconciles a collision using DefiLlama's already-stored raw payload when the GitHub organizations match", async () => {
    const defillamaCollectorId = await defiLlamaCollectorId();
    const [existingTarget] = await getDb()
      .insert(schema.securityTarget)
      .values({ slug: "repairable-protocol", name: "Repairable Protocol" })
      .returning();
    await getDb().insert(schema.securityTargetSourceIdentity).values({
      collectorId: defillamaCollectorId,
      sourceIdentifier: "repairable-protocol",
      securityTargetId: existingTarget!.id,
    });
    await getDb()
      .insert(schema.rawRecord)
      .values({
        collectorId: defillamaCollectorId,
        contentHash: "repairable-hash",
        sourceIdentifier: "repairable-protocol",
        payload: {
          slug: "repairable-protocol",
          name: "Repairable Protocol",
          github: ["repair-org"],
        },
      });

    bounties = [
      bounty({
        slug: "repairable-protocol",
        project: "Repairable Protocol (Immunefi)",
        githubUrl: "https://github.com/repair-org/repair-contracts",
      }),
    ];
    stubFetch();

    const result = await runImmunefiCollector();

    expect(result.collisions).toHaveLength(0);
    const [target] = await getDb()
      .select()
      .from(schema.securityTarget)
      .where(eq(schema.securityTarget.id, existingTarget!.id));
    expect(target?.repositoryUrl).toBe("https://github.com/repair-org");

    const identities = await getDb()
      .select()
      .from(schema.securityTargetSourceIdentity)
      .where(eq(schema.securityTargetSourceIdentity.securityTargetId, existingTarget!.id));
    expect(identities).toHaveLength(2);
  });

  it("does not reconcile when DefiLlama's stored GitHub organization conflicts with Immunefi's", async () => {
    const defillamaCollectorId = await defiLlamaCollectorId();
    const [existingTarget] = await getDb()
      .insert(schema.securityTarget)
      .values({ slug: "conflicting-protocol", name: "Conflicting Protocol" })
      .returning();
    await getDb().insert(schema.securityTargetSourceIdentity).values({
      collectorId: defillamaCollectorId,
      sourceIdentifier: "conflicting-protocol",
      securityTargetId: existingTarget!.id,
    });
    await getDb()
      .insert(schema.rawRecord)
      .values({
        collectorId: defillamaCollectorId,
        contentHash: "conflicting-hash",
        sourceIdentifier: "conflicting-protocol",
        payload: { slug: "conflicting-protocol", name: "Conflicting Protocol", github: ["org-a"] },
      });

    bounties = [
      bounty({
        slug: "conflicting-protocol",
        project: "Conflicting Protocol (Immunefi)",
        githubUrl: "https://github.com/org-b/some-repo",
      }),
    ];
    stubFetch();

    const result = await runImmunefiCollector();

    expect(result.collisions).toHaveLength(1);
    expect(result.collisions[0]?.slug).toBe("conflicting-protocol");
  });

  it("does not attempt reconciliation when Immunefi itself has no githubUrl to compare against", async () => {
    const defillamaCollectorId = await defiLlamaCollectorId();
    const [existingTarget] = await getDb()
      .insert(schema.securityTarget)
      .values({ slug: "no-evidence-protocol", name: "No Evidence Protocol" })
      .returning();
    await getDb().insert(schema.securityTargetSourceIdentity).values({
      collectorId: defillamaCollectorId,
      sourceIdentifier: "no-evidence-protocol",
      securityTargetId: existingTarget!.id,
    });
    await getDb()
      .insert(schema.rawRecord)
      .values({
        collectorId: defillamaCollectorId,
        contentHash: "no-evidence-hash",
        sourceIdentifier: "no-evidence-protocol",
        payload: {
          slug: "no-evidence-protocol",
          name: "No Evidence Protocol",
          github: ["some-org"],
        },
      });

    bounties = [
      bounty({
        slug: "no-evidence-protocol",
        project: "No Evidence Protocol (Immunefi)",
        githubUrl: null,
      }),
    ];
    stubFetch();

    const result = await runImmunefiCollector();

    expect(result.collisions).toHaveLength(1);
    // The backfill is never even attempted — the existing target's
    // repositoryUrl stays null, since repairing it could never help
    // without any evidence on Immunefi's own side to compare against.
    const [target] = await getDb()
      .select()
      .from(schema.securityTarget)
      .where(eq(schema.securityTarget.id, existingTarget!.id));
    expect(target?.repositoryUrl).toBeNull();
  });

  it("is idempotent: re-running after a successful reconciliation creates no duplicate identities or events", async () => {
    const defillamaCollectorId = await defiLlamaCollectorId();
    const [existingTarget] = await getDb()
      .insert(schema.securityTarget)
      .values({ slug: "idempotent-repair-protocol", name: "Idempotent Repair Protocol" })
      .returning();
    await getDb().insert(schema.securityTargetSourceIdentity).values({
      collectorId: defillamaCollectorId,
      sourceIdentifier: "idempotent-repair-protocol",
      securityTargetId: existingTarget!.id,
    });
    await getDb()
      .insert(schema.rawRecord)
      .values({
        collectorId: defillamaCollectorId,
        contentHash: "idempotent-repair-hash",
        sourceIdentifier: "idempotent-repair-protocol",
        payload: {
          slug: "idempotent-repair-protocol",
          name: "Idempotent Repair Protocol",
          github: ["idempotent-org"],
        },
      });

    bounties = [
      bounty({
        slug: "idempotent-repair-protocol",
        project: "Idempotent Repair Protocol (Immunefi)",
        githubUrl: "https://github.com/idempotent-org/contracts",
      }),
    ];
    stubFetch();

    const first = await runImmunefiCollector();
    expect(first.collisions).toHaveLength(0);

    const second = await runImmunefiCollector();
    expect(second.collisions).toHaveLength(0);
    expect(second.published).toBe(0);

    const identities = await getDb()
      .select()
      .from(schema.securityTargetSourceIdentity)
      .where(eq(schema.securityTargetSourceIdentity.securityTargetId, existingTarget!.id));
    expect(identities).toHaveLength(2);
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
