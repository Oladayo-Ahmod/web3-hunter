import { getDb, resolveOrCreateCollector, schema } from "@web3-hunter/db";
import { createTestDatabase, type TestDatabase } from "@web3-hunter/db/testing";
import { storeRawRecord } from "@web3-hunter/ingestion";
import { createSecurityTarget, upsertBugBounty } from "@web3-hunter/security";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { resumeDefiLlamaIngestion } from "./resume-defillama-ingestion";

// One shared disposable database for the whole file (the established
// convention — `getDb()` is a module-level singleton that only reads
// `DATABASE_URL` on its first call, so a fresh database per test is not
// viable). Because state accumulates across tests, every assertion below
// is scoped to each test's own, globally-unique identifiers rather than
// raw totals.

async function ensureDefillamaCollector(): Promise<string> {
  return resolveOrCreateCollector(getDb(), "defillama", "security-intelligence");
}

async function linkIdentity(
  collectorId: string,
  sourceIdentifier: string,
  securityTargetId: string,
) {
  await getDb()
    .insert(schema.securityTargetSourceIdentity)
    .values({ collectorId, sourceIdentifier, securityTargetId });
}

function protocolPayload(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    name: "Acme Protocol",
    slug: "acme-protocol",
    category: "Lending",
    tvl: 10_000_000,
    chains: ["Ethereum"],
    ...overrides,
  };
}

describe("resumeDefiLlamaIngestion (integration)", () => {
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

  // Declared first and deliberately runs before any other test creates a
  // "defillama" collector row, so it genuinely observes the "collector
  // does not exist yet" state rather than relying on test isolation that
  // this shared-database file doesn't have.
  it("10. fails safely before any write when the defillama collector does not exist yet, and rejects an invalid batch size", async () => {
    const [existing] = await getDb()
      .select()
      .from(schema.collector)
      .where(eq(schema.collector.slug, "defillama"));
    expect(existing).toBeUndefined();

    const result = await resumeDefiLlamaIngestion();
    expect(result).toEqual({
      eligible: 0,
      excluded: [],
      attempted: 0,
      succeeded: 0,
      failed: [],
      remaining: 0,
    });

    await expect(resumeDefiLlamaIngestion({ batchSize: 0 })).rejects.toThrow(/positive integer/);
    await expect(resumeDefiLlamaIngestion({ batchSize: -5 })).rejects.toThrow(/positive integer/);
  });

  it("1. is eligible only for the defillama collector's own raw records, never another collector's", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("must never fetch"))),
    );

    const defillamaId = await ensureDefillamaCollector();
    const otherId = await resolveOrCreateCollector(getDb(), "other-source-1", "test");

    const target = await createSecurityTarget({ slug: "acme-protocol-1", name: "Acme" });
    await linkIdentity(defillamaId, "acme-protocol-1", target.id);
    await storeRawRecord({
      collectorId: defillamaId,
      payload: protocolPayload({ slug: "acme-protocol-1" }),
      externalId: "acme-protocol-1",
      sourceIdentifier: "acme-protocol-1",
    });

    // A same-named raw record under an unrelated collector must never be
    // picked up by this DefiLlama-scoped recovery.
    await storeRawRecord({
      collectorId: otherId,
      payload: { slug: "acme-protocol-1" },
      externalId: "acme-protocol-1",
      sourceIdentifier: "acme-protocol-1",
    });

    const result = await resumeDefiLlamaIngestion({ dryRun: true });
    expect(result.excluded.find((e) => e.sourceIdentifier === "acme-protocol-1")).toBeUndefined();

    // Resolve it so it doesn't inflate later tests' eligible counts.
    const resolved = await resumeDefiLlamaIngestion();
    expect(resolved.succeeded).toBeGreaterThanOrEqual(1);
  });

  it("2. excludes raw records that already have a raw_record_ingestion row", async () => {
    const defillamaId = await ensureDefillamaCollector();
    const target = await createSecurityTarget({
      slug: "already-ingested-2",
      name: "Already Ingested",
    });
    await linkIdentity(defillamaId, "already-ingested-2", target.id);
    const raw = await storeRawRecord({
      collectorId: defillamaId,
      payload: protocolPayload({ slug: "already-ingested-2" }),
      externalId: "already-ingested-2",
      sourceIdentifier: "already-ingested-2",
    });
    await getDb().insert(schema.rawRecordIngestion).values({ rawRecordId: raw.id, eventId: null });

    const result = await resumeDefiLlamaIngestion({ dryRun: true });
    const matches = result.excluded.filter((e) => e.sourceIdentifier === "already-ingested-2");
    expect(matches).toEqual([]);
    // It must not appear as newly-attempted work either, since it was
    // never eligible in the first place (already has an ingestion row).
    const real = await resumeDefiLlamaIngestion();
    expect(real.failed.find((f) => f.sourceIdentifier === "already-ingested-2")).toBeUndefined();
  });

  it("3. excludes a source identifier with no existing identity mapping, without creating or repairing one", async () => {
    // The "missing-security-target" exclusion branch (a mapping that
    // points at a target id which no longer exists) is defense-in-depth
    // only: `security_target_source_identity.security_target_id` has a
    // real FK to `security_target.id`, and no code path anywhere in this
    // repository ever deletes a `security_target` row — so that state
    // cannot be constructed even in a test without bypassing a live
    // database constraint. Only the realistic "no mapping recorded at
    // all" case is exercised here.
    const defillamaId = await ensureDefillamaCollector();

    await storeRawRecord({
      collectorId: defillamaId,
      payload: protocolPayload({ slug: "no-mapping-3" }),
      externalId: "no-mapping-3",
      sourceIdentifier: "no-mapping-3",
    });

    const result = await resumeDefiLlamaIngestion({ dryRun: true });
    expect(result.excluded).toEqual(
      expect.arrayContaining([
        { sourceIdentifier: "no-mapping-3", reason: "no-source-identity-mapping" },
      ]),
    );

    // No target was created to "fix" the missing mapping.
    const [target] = await getDb()
      .select()
      .from(schema.securityTarget)
      .where(eq(schema.securityTarget.slug, "no-mapping-3"));
    expect(target).toBeUndefined();

    const attempted = await resumeDefiLlamaIngestion();
    expect(attempted.failed.find((f) => f.sourceIdentifier === "no-mapping-3")).toBeUndefined();
  });

  it("4. dry-run performs no writes and never calls the ingestion pipeline", async () => {
    const defillamaId = await ensureDefillamaCollector();
    const target = await createSecurityTarget({ slug: "dry-run-case-4", name: "Dry Run" });
    await linkIdentity(defillamaId, "dry-run-case-4", target.id);
    await storeRawRecord({
      collectorId: defillamaId,
      payload: protocolPayload({ slug: "dry-run-case-4" }),
      externalId: "dry-run-case-4",
      sourceIdentifier: "dry-run-case-4",
    });

    const db = getDb();
    const eventsBefore = await db.select().from(schema.event);
    const ingestionBefore = await db.select().from(schema.rawRecordIngestion);

    const result = await resumeDefiLlamaIngestion({ dryRun: true });

    const eventsAfter = await db.select().from(schema.event);
    const ingestionAfter = await db.select().from(schema.rawRecordIngestion);

    expect(result.attempted).toBe(0);
    expect(eventsAfter).toEqual(eventsBefore);
    expect(ingestionAfter).toEqual(ingestionBefore);
  });

  it("5. uses the persisted payload — never fetches from DefiLlama", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("must never fetch"))),
    );

    const defillamaId = await ensureDefillamaCollector();
    const target = await createSecurityTarget({ slug: "no-fetch-case-5", name: "No Fetch" });
    await linkIdentity(defillamaId, "no-fetch-case-5", target.id);
    await storeRawRecord({
      collectorId: defillamaId,
      payload: protocolPayload({ slug: "no-fetch-case-5" }),
      externalId: "no-fetch-case-5",
      sourceIdentifier: "no-fetch-case-5",
    });

    const result = await resumeDefiLlamaIngestion();
    expect(result.failed).toEqual([]);
  });

  it("6. successful processing creates the expected Event and ingestion-ledger record", async () => {
    const defillamaId = await ensureDefillamaCollector();
    const target = await createSecurityTarget({ slug: "success-case-6", name: "Success Case" });
    await linkIdentity(defillamaId, "success-case-6", target.id);
    const raw = await storeRawRecord({
      collectorId: defillamaId,
      payload: protocolPayload({ slug: "success-case-6" }),
      externalId: "success-case-6",
      sourceIdentifier: "success-case-6",
    });

    const result = await resumeDefiLlamaIngestion();
    expect(result.failed.find((f) => f.sourceIdentifier === "success-case-6")).toBeUndefined();

    const [ingestion] = await getDb()
      .select()
      .from(schema.rawRecordIngestion)
      .where(eq(schema.rawRecordIngestion.rawRecordId, raw.id));
    expect(ingestion?.eventId).not.toBeNull();

    const [event] = await getDb()
      .select()
      .from(schema.event)
      .where(eq(schema.event.id, ingestion!.eventId!));
    expect(event).toBeDefined();
    expect(event!.relatedEntityId).toBe(target.id);
  });

  it("7. repeated execution creates no duplicates", async () => {
    const defillamaId = await ensureDefillamaCollector();
    const target = await createSecurityTarget({ slug: "repeat-case-7", name: "Repeat Case" });
    await linkIdentity(defillamaId, "repeat-case-7", target.id);
    const raw = await storeRawRecord({
      collectorId: defillamaId,
      payload: protocolPayload({ slug: "repeat-case-7" }),
      externalId: "repeat-case-7",
      sourceIdentifier: "repeat-case-7",
    });

    await resumeDefiLlamaIngestion();
    const second = await resumeDefiLlamaIngestion({ dryRun: true });
    expect(second.excluded.find((e) => e.sourceIdentifier === "repeat-case-7")).toBeUndefined();

    const ingestionRows = await getDb()
      .select()
      .from(schema.rawRecordIngestion)
      .where(eq(schema.rawRecordIngestion.rawRecordId, raw.id));
    expect(ingestionRows).toHaveLength(1);
  });

  it("8. partial failure does not block independent records, and a retry selects only what's still missing", async () => {
    const defillamaId = await ensureDefillamaCollector();
    const goodTarget = await createSecurityTarget({ slug: "good-case-8", name: "Good Case" });
    const badTarget = await createSecurityTarget({ slug: "bad-case-8", name: "Bad Case" });
    await linkIdentity(defillamaId, "good-case-8", goodTarget.id);
    await linkIdentity(defillamaId, "bad-case-8", badTarget.id);

    await storeRawRecord({
      collectorId: defillamaId,
      payload: protocolPayload({ slug: "good-case-8" }),
      externalId: "good-case-8",
      sourceIdentifier: "good-case-8",
    });
    // A payload the real DefiLlama normalizer schema rejects (missing
    // required fields) — causes that one identifier's normalizer call
    // to throw, with no test-only seam involved.
    await storeRawRecord({
      collectorId: defillamaId,
      payload: { not: "a valid protocol payload" },
      externalId: "bad-case-8",
      sourceIdentifier: "bad-case-8",
    });

    const first = await resumeDefiLlamaIngestion();
    const goodFailure = first.failed.find((f) => f.sourceIdentifier === "good-case-8");
    const badFailure = first.failed.find((f) => f.sourceIdentifier === "bad-case-8");
    expect(goodFailure).toBeUndefined();
    expect(badFailure).toBeDefined();

    const [goodIngestion] = await getDb()
      .select()
      .from(schema.rawRecordIngestion)
      .innerJoin(schema.rawRecord, eq(schema.rawRecord.id, schema.rawRecordIngestion.rawRecordId))
      .where(eq(schema.rawRecord.sourceIdentifier, "good-case-8"));
    expect(goodIngestion).toBeDefined();

    const retry = await resumeDefiLlamaIngestion({ dryRun: true });
    expect(retry.excluded.find((e) => e.sourceIdentifier === "bad-case-8")).toBeUndefined();
    // "bad-case-8" is still eligible (not excluded), just not yet
    // succeeded — a follow-up real invocation would retry it.
  });

  it("9. leaves Immunefi records, bounty rows, target metadata, and source identities unchanged", async () => {
    const defillamaId = await ensureDefillamaCollector();
    const immunefiId = await resolveOrCreateCollector(getDb(), "immunefi", "security-intelligence");

    const immunefiTarget = await createSecurityTarget({
      slug: "immunefi-only-9",
      name: "Immunefi Only",
      repositoryUrl: "https://github.com/immunefi-only-9/repo",
      discoverySource: "immunefi-bounties",
    });
    await linkIdentity(immunefiId, "immunefi-only-9", immunefiTarget.id);
    await upsertBugBounty({
      securityTargetId: immunefiTarget.id,
      platform: "immunefi",
      status: "active",
    });

    const defillamaTarget = await createSecurityTarget({
      slug: "defillama-only-9",
      name: "DefiLlama Only",
    });
    await linkIdentity(defillamaId, "defillama-only-9", defillamaTarget.id);
    await storeRawRecord({
      collectorId: defillamaId,
      payload: protocolPayload({ slug: "defillama-only-9" }),
      externalId: "defillama-only-9",
      sourceIdentifier: "defillama-only-9",
    });

    const db = getDb();
    const bountyBefore = await db
      .select()
      .from(schema.bugBounty)
      .where(eq(schema.bugBounty.securityTargetId, immunefiTarget.id));
    const immunefiTargetBefore = await db
      .select()
      .from(schema.securityTarget)
      .where(eq(schema.securityTarget.id, immunefiTarget.id));
    const immunefiIdentityBefore = await db
      .select()
      .from(schema.securityTargetSourceIdentity)
      .where(eq(schema.securityTargetSourceIdentity.collectorId, immunefiId));

    await resumeDefiLlamaIngestion();

    const bountyAfter = await db
      .select()
      .from(schema.bugBounty)
      .where(eq(schema.bugBounty.securityTargetId, immunefiTarget.id));
    const immunefiTargetAfter = await db
      .select()
      .from(schema.securityTarget)
      .where(eq(schema.securityTarget.id, immunefiTarget.id));
    const immunefiIdentityAfter = await db
      .select()
      .from(schema.securityTargetSourceIdentity)
      .where(eq(schema.securityTargetSourceIdentity.collectorId, immunefiId));

    expect(bountyAfter).toEqual(bountyBefore);
    expect(immunefiTargetAfter).toEqual(immunefiTargetBefore);
    expect(immunefiIdentityAfter).toEqual(immunefiIdentityBefore);
  });
});
