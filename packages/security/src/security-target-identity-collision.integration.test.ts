import { getDb, schema } from "@web3-hunter/db";
import { createTestDatabase, type TestDatabase } from "@web3-hunter/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSecurityTarget } from "./security-target-store";
import {
  SecurityTargetIdentityCollisionError,
  resolveSecurityTargetWithCollisionCheck,
} from "./security-target-store";

async function createCollector(slug: string) {
  const [collector] = await getDb()
    .insert(schema.collector)
    .values({ slug, sourceType: "test" })
    .returning();
  return collector!.id;
}

describe("resolveSecurityTargetWithCollisionCheck (integration)", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    process.env.DATABASE_URL = testDb.connectionString;
  }, 60_000);

  afterAll(async () => {
    await testDb.stop();
  });

  it("creates a new Security Target and records identity when no slug collision exists", async () => {
    const collectorId = await createCollector("source-a");

    const securityTargetId = await resolveSecurityTargetWithCollisionCheck(collectorId, "acme", {
      slug: "acme",
      name: "Acme",
      repositoryUrl: "https://github.com/acme/acme",
    });

    const target = await getDb()
      .select()
      .from(schema.securityTarget)
      .where(eq(schema.securityTarget.id, securityTargetId));
    expect(target).toHaveLength(1);
  });

  it("resolves the same Collector's own already-recorded identity without re-checking for a collision", async () => {
    const collectorId = await createCollector("source-b");

    const first = await resolveSecurityTargetWithCollisionCheck(collectorId, "widget", {
      slug: "widget",
      name: "Widget",
      repositoryUrl: "https://github.com/widget/widget",
    });
    const second = await resolveSecurityTargetWithCollisionCheck(collectorId, "widget", {
      slug: "widget",
      name: "Widget",
      repositoryUrl: "https://github.com/widget/widget",
    });

    expect(second).toBe(first);
  });

  it("legitimate cross-source resolution: unifies when both sides' repositoryUrl matches (case/trailing-slash-insensitive)", async () => {
    const collectorA = await createCollector("source-c1");
    const collectorB = await createCollector("source-c2");

    const targetId = await resolveSecurityTargetWithCollisionCheck(collectorA, "aave", {
      slug: "aave",
      name: "Aave",
      repositoryUrl: "https://github.com/aave/aave-v3-core",
    });

    const sameTargetId = await resolveSecurityTargetWithCollisionCheck(collectorB, "aave", {
      slug: "aave",
      name: "Aave Protocol",
      repositoryUrl: "HTTPS://GITHUB.COM/aave/aave-v3-core/",
    });

    expect(sameTargetId).toBe(targetId);

    const identities = await getDb()
      .select()
      .from(schema.securityTargetSourceIdentity)
      .where(eq(schema.securityTargetSourceIdentity.securityTargetId, targetId));
    expect(identities).toHaveLength(2);
    expect(identities.map((identity) => identity.collectorId).sort()).toEqual(
      [collectorA, collectorB].sort(),
    );
  });

  it("ambiguous slug collision: throws and does not merge when repositoryUrls differ", async () => {
    const collectorA = await createCollector("source-d1");
    const collectorB = await createCollector("source-d2");

    await resolveSecurityTargetWithCollisionCheck(collectorA, "lido", {
      slug: "lido",
      name: "Lido",
      repositoryUrl: "https://github.com/lidofinance/lido-dao",
    });

    await expect(
      resolveSecurityTargetWithCollisionCheck(collectorB, "lido", {
        slug: "lido",
        name: "Lido (unrelated fork)",
        repositoryUrl: "https://github.com/some-other-org/lido-fork",
      }),
    ).rejects.toThrow(SecurityTargetIdentityCollisionError);

    const identities = await getDb()
      .select()
      .from(schema.securityTargetSourceIdentity)
      .where(eq(schema.securityTargetSourceIdentity.collectorId, collectorB));
    expect(identities).toHaveLength(0);
  });

  it("ambiguous slug collision: throws when the existing target has no repositoryUrl to compare against", async () => {
    const collectorA = await createCollector("source-e1");
    const collectorB = await createCollector("source-e2");

    // Created directly, the way DefiLlama's collector resolves targets
    // today — no repositoryUrl at all.
    await createSecurityTarget({ slug: "compound", name: "Compound" });
    await getDb()
      .insert(schema.securityTargetSourceIdentity)
      .values({
        collectorId: collectorA,
        sourceIdentifier: "compound",
        securityTargetId: (
          await getDb()
            .select()
            .from(schema.securityTarget)
            .where(eq(schema.securityTarget.slug, "compound"))
        )[0]!.id,
      });

    await expect(
      resolveSecurityTargetWithCollisionCheck(collectorB, "compound", {
        slug: "compound",
        name: "Compound Finance",
        repositoryUrl: "https://github.com/compound-finance/compound-protocol",
      }),
    ).rejects.toThrow(SecurityTargetIdentityCollisionError);
  });

  it("ambiguous slug collision: throws when neither side has a repositoryUrl", async () => {
    const collectorA = await createCollector("source-f1");
    const collectorB = await createCollector("source-f2");

    await resolveSecurityTargetWithCollisionCheck(collectorA, "no-evidence", {
      slug: "no-evidence",
      name: "No Evidence Co",
    });

    await expect(
      resolveSecurityTargetWithCollisionCheck(collectorB, "no-evidence", {
        slug: "no-evidence",
        name: "A Different Project",
      }),
    ).rejects.toThrow(SecurityTargetIdentityCollisionError);
  });
});
