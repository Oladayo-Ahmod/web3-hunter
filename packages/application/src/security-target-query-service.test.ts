import { getDb, schema } from "@web3-hunter/db";
import { createTestDatabase, type TestDatabase } from "@web3-hunter/db/testing";
import {
  createSecurityTarget,
  persistSecuritySignal,
  runSecurityScoringPipeline,
  upsertBugBounty,
  upsertSecurityTargetIntelligence,
} from "@web3-hunter/security";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  getSecurityTargetPriorityBySlug,
  listSecurityTargetPriority,
  listSecurityTargetPriorityPage,
  securityTargetFeedQuerySchema,
} from "./security-target-query-service";

const BASE_DATE = new Date("2026-01-01T00:00:00Z");

async function insertBountyProgramEvent(input: {
  securityTargetId: string;
  occurredAt: Date;
  audits?: Array<{ id: string; url: string | null; auditor: string | null; date: string | null }>;
  smartContractAssetIds?: string[];
  /** Omitted entirely (not just `[]`) when not supplied — matches a real payload captured before per-asset detail was tracked. */
  assets?: Array<{ id: string; type: string; description: string | null; url: string | null }>;
  endDate?: string | null;
}) {
  await getDb()
    .insert(schema.event)
    .values({
      type: "BountyProgramRecorded",
      category: "source",
      version: 1,
      sourceLabel: "test",
      occurredAt: input.occurredAt,
      relatedEntityType: "security_target",
      relatedEntityId: input.securityTargetId,
      confidence: 1,
      metadata: {
        audits: input.audits ?? [],
        smartContractAssetIds: input.smartContractAssetIds ?? [],
        ...(input.assets ? { assets: input.assets } : {}),
        endDate: input.endDate ?? null,
      },
    });
}

/**
 * Inserts a real `ProtocolSnapshotRecorded`/`ProtocolSnapshotUpdated`
 * canonical Event directly — mirrors `insertBountyProgramEvent`'s own
 * convention for this file. Only the canonical Event is hand-inserted;
 * every Signal and Opportunity produced from it comes from a real
 * `runSecurityScoringPipeline` call, never from a hand-inserted row.
 */
async function insertProtocolSnapshotEvent(input: {
  securityTargetId: string;
  occurredAt: Date;
  type?: "ProtocolSnapshotRecorded" | "ProtocolSnapshotUpdated";
  tvl?: number | null;
  audits?: string | null;
  category?: string | null;
  changedFrom?: Record<string, unknown>;
}) {
  const metadata: Record<string, unknown> = {
    slug: "stage6-protocol",
    name: "Stage 6 Protocol",
    category: input.category ?? null,
    tvl: input.tvl ?? 10_000_000,
    change1d: null,
    change7d: null,
    listedAt: null,
    audits: input.audits ?? "0",
    auditLinks: [],
    chains: ["Ethereum"],
    ...(input.changedFrom ? { changedFrom: input.changedFrom } : {}),
  };

  await getDb()
    .insert(schema.event)
    .values({
      type: input.type ?? "ProtocolSnapshotRecorded",
      category: "source",
      version: 1,
      sourceLabel: "test",
      occurredAt: input.occurredAt,
      relatedEntityType: "security_target",
      relatedEntityId: input.securityTargetId,
      confidence: 1,
      metadata,
    });
}

async function seedSignal(input: {
  securityTargetId: string;
  signalType: string;
  sourceEventIds?: string[];
}) {
  return persistSecuritySignal({
    securityTargetId: input.securityTargetId,
    signalType: input.signalType,
    weight: 0.5,
    reasoning: `test signal: ${input.signalType}`,
    sourceEventIds: input.sourceEventIds ?? [randomUUID()],
    detectedAt: BASE_DATE,
  });
}

function findBySlug(rows: Awaited<ReturnType<typeof listSecurityTargetPriority>>, slug: string) {
  const row = rows.find((r) => r.slug === slug);
  if (!row) {
    throw new Error(`Expected a result for slug "${slug}"`);
  }
  return row;
}

describe("security-target-query-service (integration)", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    process.env.DATABASE_URL = testDb.connectionString;
  }, 60_000);

  afterAll(async () => {
    await testDb.stop();
  });

  describe("listSecurityTargetPriority — tiers", () => {
    it("returns Tier C for a freshly discovered target with no Signal and no Opportunity", async () => {
      const target = await createSecurityTarget({ slug: "test-tier-c-discovery-only", name: "T" });

      const rows = await listSecurityTargetPriority();
      const row = findBySlug(rows, target.slug);

      expect(row.tier).toBe("C");
      expect(row.tierReason).toMatch(/no detected security signal qualifies/i);
      expect(row.qualifyingSignalTypes).toEqual([]);
      expect(row.hasOpportunity).toBe(false);
      expect(row.distinctEvidenceEventCount).toBe(0);
      expect(row.lastSignalAt).toBeNull();
    });

    it("keeps Tier C when only a non-qualifying Signal type is present — it never elevates the tier", async () => {
      const target = await createSecurityTarget({ slug: "test-tier-c-non-qualifying", name: "T" });
      await seedSignal({ securityTargetId: target.id, signalType: "bounty-program-observed" });

      const rows = await listSecurityTargetPriority();
      const row = findBySlug(rows, target.slug);

      expect(row.tier).toBe("C");
      expect(row.qualifyingSignalTypes).toEqual([]);
    });

    it("returns Tier B for a qualifying Signal whose type does not name a specific artifact", async () => {
      const target = await createSecurityTarget({ slug: "test-tier-b-generic", name: "T" });
      await seedSignal({ securityTargetId: target.id, signalType: "tvl-growth" });

      const rows = await listSecurityTargetPriority();
      const row = findBySlug(rows, target.slug);

      expect(row.tier).toBe("B");
      expect(row.tierReason).toMatch(/none of them name a specific artifact/i);
      expect(row.qualifyingSignalTypes).toEqual(["tvl-growth"]);
    });

    it("stays Tier B even when a qualifying-but-generic Signal co-occurs with a non-qualifying one", async () => {
      const target = await createSecurityTarget({ slug: "test-tier-b-mixed", name: "T" });
      await seedSignal({ securityTargetId: target.id, signalType: "bounty-program-resumed" });
      await seedSignal({ securityTargetId: target.id, signalType: "bounty-program-paused" });

      const rows = await listSecurityTargetPriority();
      const row = findBySlug(rows, target.slug);

      expect(row.tier).toBe("B");
      expect(row.qualifyingSignalTypes).toEqual(["bounty-program-resumed"]);
    });

    it("returns Tier A for a qualifying Signal whose type names a specific artifact", async () => {
      const target = await createSecurityTarget({ slug: "test-tier-a-artifact", name: "T" });
      await seedSignal({ securityTargetId: target.id, signalType: "bounty-scope-expanded" });

      const rows = await listSecurityTargetPriority();
      const row = findBySlug(rows, target.slug);

      expect(row.tier).toBe("A");
      expect(row.tierReason).toMatch(/names a specific artifact/i);
      expect(row.qualifyingSignalTypes).toEqual(["bounty-scope-expanded"]);
    });

    it("prefers Tier A over Tier B when both an artifact-naming and a generic qualifying Signal exist", async () => {
      const target = await createSecurityTarget({ slug: "test-tier-a-over-b", name: "T" });
      await seedSignal({ securityTargetId: target.id, signalType: "tvl-growth" });
      await seedSignal({ securityTargetId: target.id, signalType: "bounty-scope-expanded" });

      const rows = await listSecurityTargetPriority();
      const row = findBySlug(rows, target.slug);

      expect(row.tier).toBe("A");
      expect(row.qualifyingSignalTypes).toEqual(["bounty-scope-expanded", "tvl-growth"]);
    });
  });

  describe("listSecurityTargetPriority — distinct triggering Event counting", () => {
    it("counts two Signal rows sharing one triggering Event as one distinct Event", async () => {
      const target = await createSecurityTarget({ slug: "test-shared-event", name: "T" });
      const sharedEventId = randomUUID();
      await seedSignal({
        securityTargetId: target.id,
        signalType: "new-protocol",
        sourceEventIds: [sharedEventId],
      });
      await seedSignal({
        securityTargetId: target.id,
        signalType: "audit-coverage-gap",
        sourceEventIds: [sharedEventId],
      });

      const rows = await listSecurityTargetPriority();
      const row = findBySlug(rows, target.slug);

      expect(row.distinctEvidenceEventCount).toBe(1);
    });

    it("counts Signal rows from genuinely separate triggering Events as separate", async () => {
      const target = await createSecurityTarget({ slug: "test-distinct-events", name: "T" });
      await seedSignal({
        securityTargetId: target.id,
        signalType: "tvl-growth",
        sourceEventIds: [randomUUID()],
      });
      await seedSignal({
        securityTargetId: target.id,
        signalType: "audit-coverage-gap",
        sourceEventIds: [randomUUID()],
      });

      const rows = await listSecurityTargetPriority();
      const row = findBySlug(rows, target.slug);

      expect(row.distinctEvidenceEventCount).toBe(2);
    });
  });

  describe("listSecurityTargetPriority — audit evidence", () => {
    it("reports 'unavailable' when no bounty-program source Event exists for this target", async () => {
      const target = await createSecurityTarget({ slug: "test-audit-unavailable", name: "T" });

      const rows = await listSecurityTargetPriority();
      const row = findBySlug(rows, target.slug);

      expect(row.audit.status).toBe("unavailable");
      expect(row.audit.entries).toEqual([]);
      expect(row.audit.limitation).toMatch(/does not confirm/i);
    });

    it("reports 'none' when a bounty-program Event exists with zero recorded audits", async () => {
      const target = await createSecurityTarget({ slug: "test-audit-none", name: "T" });
      await insertBountyProgramEvent({
        securityTargetId: target.id,
        occurredAt: BASE_DATE,
        audits: [],
      });

      const rows = await listSecurityTargetPriority();
      const row = findBySlug(rows, target.slug);

      expect(row.audit.status).toBe("none");
      expect(row.audit.entries).toEqual([]);
    });

    it("reports 'present' with full entries for complete audit metadata", async () => {
      const target = await createSecurityTarget({ slug: "test-audit-present-full", name: "T" });
      await insertBountyProgramEvent({
        securityTargetId: target.id,
        occurredAt: BASE_DATE,
        audits: [
          {
            id: "audit-1",
            url: "https://example.test/audit-1",
            auditor: "Acme Audits",
            date: "2024-01-01",
          },
        ],
      });

      const rows = await listSecurityTargetPriority();
      const row = findBySlug(rows, target.slug);

      expect(row.audit.status).toBe("present");
      expect(row.audit.entries).toEqual([
        {
          id: "audit-1",
          auditor: "Acme Audits",
          url: "https://example.test/audit-1",
          date: "2024-01-01",
        },
      ]);
    });

    it("reports 'present' preserving partial entries (missing auditor/date) honestly, not fabricated", async () => {
      const target = await createSecurityTarget({ slug: "test-audit-present-partial", name: "T" });
      await insertBountyProgramEvent({
        securityTargetId: target.id,
        occurredAt: BASE_DATE,
        audits: [{ id: "audit-2", url: null, auditor: null, date: null }],
      });

      const rows = await listSecurityTargetPriority();
      const row = findBySlug(rows, target.slug);

      expect(row.audit.status).toBe("present");
      expect(row.audit.entries).toEqual([{ id: "audit-2", auditor: null, url: null, date: null }]);
    });

    it("reads the most recent bounty-program Event when more than one is recorded", async () => {
      const target = await createSecurityTarget({ slug: "test-audit-latest-event", name: "T" });
      await insertBountyProgramEvent({
        securityTargetId: target.id,
        occurredAt: new Date(BASE_DATE.getTime() - 1000),
        audits: [{ id: "old-audit", url: null, auditor: null, date: null }],
      });
      await insertBountyProgramEvent({
        securityTargetId: target.id,
        occurredAt: BASE_DATE,
        audits: [{ id: "new-audit", url: null, auditor: null, date: null }],
      });

      const rows = await listSecurityTargetPriority();
      const row = findBySlug(rows, target.slug);

      expect(row.audit.entries.map((e) => e.id)).toEqual(["new-audit"]);
    });
  });

  describe("listSecurityTargetPriority — actionability", () => {
    it("is not actionable when no bug bounty is on record", async () => {
      const target = await createSecurityTarget({ slug: "test-action-no-bounty", name: "T" });

      const rows = await listSecurityTargetPriority();
      const row = findBySlug(rows, target.slug);

      expect(row.actionability.isActionable).toBe(false);
      expect(row.actionability.reason).toMatch(/no active bug bounty/i);
    });

    it("is not actionable when the bounty is paused, even with in-scope assets", async () => {
      const target = await createSecurityTarget({ slug: "test-action-paused", name: "T" });
      await upsertBugBounty({
        securityTargetId: target.id,
        platform: "immunefi",
        status: "paused",
      });
      await insertBountyProgramEvent({
        securityTargetId: target.id,
        occurredAt: BASE_DATE,
        smartContractAssetIds: ["asset-1"],
      });

      const rows = await listSecurityTargetPriority();
      const row = findBySlug(rows, target.slug);

      expect(row.actionability.isActionable).toBe(false);
      expect(row.actionability.reason).toMatch(/paused/i);
    });

    it("is not actionable when the bounty is active but no smart-contract asset is in scope", async () => {
      const target = await createSecurityTarget({ slug: "test-action-no-scope", name: "T" });
      await upsertBugBounty({
        securityTargetId: target.id,
        platform: "immunefi",
        status: "active",
      });
      await insertBountyProgramEvent({
        securityTargetId: target.id,
        occurredAt: BASE_DATE,
        smartContractAssetIds: [],
      });

      const rows = await listSecurityTargetPriority();
      const row = findBySlug(rows, target.slug);

      expect(row.actionability.isActionable).toBe(false);
      expect(row.actionability.reason).toMatch(/no smart-contract asset/i);
    });

    it("is actionable when the bounty is active with at least one smart-contract asset in scope", async () => {
      const target = await createSecurityTarget({ slug: "test-action-concrete", name: "T" });
      await upsertBugBounty({
        securityTargetId: target.id,
        platform: "immunefi",
        status: "active",
      });
      await insertBountyProgramEvent({
        securityTargetId: target.id,
        occurredAt: BASE_DATE,
        smartContractAssetIds: ["asset-1", "asset-2"],
      });

      const rows = await listSecurityTargetPriority();
      const row = findBySlug(rows, target.slug);

      expect(row.actionability.isActionable).toBe(true);
      expect(row.actionability.reason).toMatch(/2 smart-contract asset/i);
    });

    it("is NOT actionable when the bounty is marked active but its endDate has already passed", async () => {
      // Reproduces the real, measured gap (Phase 3 audit): Immunefi's own
      // `isPaused` flag stays false for a concluded, time-boxed
      // competition, so `bug_bounty.status` alone reads "active" forever
      // — `endDate` is the only field that can tell the program has
      // concluded. 62/196 live "active" bounty rows were found in this
      // state during the Phase 3 audit.
      const target = await createSecurityTarget({ slug: "test-action-expired", name: "T" });
      await upsertBugBounty({
        securityTargetId: target.id,
        platform: "immunefi",
        status: "active",
      });
      const pastEndDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      await insertBountyProgramEvent({
        securityTargetId: target.id,
        occurredAt: BASE_DATE,
        smartContractAssetIds: ["asset-1"],
        endDate: pastEndDate,
      });

      const rows = await listSecurityTargetPriority();
      const row = findBySlug(rows, target.slug);

      expect(row.actionability.isActionable).toBe(false);
      expect(row.actionability.reason).toMatch(/already concluded/i);
    });

    it("is actionable when the bounty is active with a future endDate and in-scope assets", async () => {
      const target = await createSecurityTarget({ slug: "test-action-future-end", name: "T" });
      await upsertBugBounty({
        securityTargetId: target.id,
        platform: "immunefi",
        status: "active",
      });
      const futureEndDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      await insertBountyProgramEvent({
        securityTargetId: target.id,
        occurredAt: BASE_DATE,
        smartContractAssetIds: ["asset-1"],
        endDate: futureEndDate,
      });

      const rows = await listSecurityTargetPriority();
      const row = findBySlug(rows, target.slug);

      expect(row.actionability.isActionable).toBe(true);
    });

    it("is still actionable when endDate is in the near future — not yet expired", async () => {
      // Strict comparison (mirrors `isBountyProgramExpired`'s own doc
      // comment): only an endDate that has actually passed counts as
      // expired, never one merely approaching.
      const target = await createSecurityTarget({ slug: "test-action-exact-enddate", name: "T" });
      await upsertBugBounty({
        securityTargetId: target.id,
        platform: "immunefi",
        status: "active",
      });
      const almostNow = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      await insertBountyProgramEvent({
        securityTargetId: target.id,
        occurredAt: BASE_DATE,
        smartContractAssetIds: ["asset-1"],
        endDate: almostNow,
      });

      const rows = await listSecurityTargetPriority();
      const row = findBySlug(rows, target.slug);

      expect(row.actionability.isActionable).toBe(true);
    });
  });

  describe("listSecurityTargetPriority — scope asset evidence and scopeUrl", () => {
    it("surfaces only smart-contract-typed assets, in source order, filtering out other types", async () => {
      const target = await createSecurityTarget({ slug: "test-scope-mixed-types", name: "T" });
      await upsertBugBounty({
        securityTargetId: target.id,
        platform: "immunefi",
        status: "active",
      });
      await insertBountyProgramEvent({
        securityTargetId: target.id,
        occurredAt: BASE_DATE,
        smartContractAssetIds: ["asset-1", "asset-3"],
        assets: [
          {
            id: "asset-1",
            type: "smart_contract",
            description: "Vault",
            url: "https://a/Vault.sol",
          },
          {
            id: "asset-2",
            type: "websites_and_applications",
            description: "App",
            url: "https://b",
          },
          {
            id: "asset-3",
            type: "smart_contract",
            description: "Router",
            url: "https://a/Router.sol",
          },
        ],
      });

      const rows = await listSecurityTargetPriority();
      const row = findBySlug(rows, target.slug);

      expect(row.actionability.assets).toEqual([
        { id: "asset-1", description: "Vault", url: "https://a/Vault.sol" },
        { id: "asset-3", description: "Router", url: "https://a/Router.sol" },
      ]);
      expect(row.actionability.totalAssetCount).toBe(2);
    });

    it("leaves assets empty and totalAssetCount at 0 when assets metadata is entirely absent", async () => {
      const target = await createSecurityTarget({
        slug: "test-scope-no-assets-metadata",
        name: "T",
      });
      await upsertBugBounty({
        securityTargetId: target.id,
        platform: "immunefi",
        status: "active",
      });
      await insertBountyProgramEvent({
        securityTargetId: target.id,
        occurredAt: BASE_DATE,
        smartContractAssetIds: ["asset-1"],
        // No `assets` field at all — a payload captured before per-asset
        // detail was tracked. `isActionable` must stay unaffected
        // (unchanged source: `smartContractAssetIds`).
      });

      const rows = await listSecurityTargetPriority();
      const row = findBySlug(rows, target.slug);

      expect(row.actionability.isActionable).toBe(true);
      expect(row.actionability.assets).toEqual([]);
      expect(row.actionability.totalAssetCount).toBe(0);
    });

    it("preserves null description/url exactly as the source supplied them, never fabricating a value", async () => {
      const target = await createSecurityTarget({ slug: "test-scope-null-fields", name: "T" });
      await upsertBugBounty({
        securityTargetId: target.id,
        platform: "immunefi",
        status: "active",
      });
      await insertBountyProgramEvent({
        securityTargetId: target.id,
        occurredAt: BASE_DATE,
        smartContractAssetIds: ["asset-1"],
        assets: [{ id: "asset-1", type: "smart_contract", description: null, url: null }],
      });

      const rows = await listSecurityTargetPriority();
      const row = findBySlug(rows, target.slug);

      expect(row.actionability.assets).toEqual([{ id: "asset-1", description: null, url: null }]);
    });

    it("exposes scopeUrl from the stored bug_bounty row when actionable", async () => {
      const target = await createSecurityTarget({ slug: "test-scope-url-actionable", name: "T" });
      await upsertBugBounty({
        securityTargetId: target.id,
        platform: "immunefi",
        status: "active",
        scopeUrl: "https://immunefi.com/bug-bounty/test-scope-url-actionable/",
      });
      await insertBountyProgramEvent({
        securityTargetId: target.id,
        occurredAt: BASE_DATE,
        smartContractAssetIds: ["asset-1"],
        assets: [{ id: "asset-1", type: "smart_contract", description: "V", url: "https://a" }],
      });

      const rows = await listSecurityTargetPriority();
      const row = findBySlug(rows, target.slug);

      expect(row.actionability.scopeUrl).toBe(
        "https://immunefi.com/bug-bounty/test-scope-url-actionable/",
      );
    });

    it("exposes scopeUrl from the stored bug_bounty row even when not actionable (paused)", async () => {
      const target = await createSecurityTarget({ slug: "test-scope-url-paused", name: "T" });
      await upsertBugBounty({
        securityTargetId: target.id,
        platform: "immunefi",
        status: "paused",
        scopeUrl: "https://immunefi.com/bug-bounty/test-scope-url-paused/",
      });

      const rows = await listSecurityTargetPriority();
      const row = findBySlug(rows, target.slug);

      expect(row.actionability.isActionable).toBe(false);
      expect(row.actionability.scopeUrl).toBe(
        "https://immunefi.com/bug-bounty/test-scope-url-paused/",
      );
      expect(row.actionability.assets).toEqual([]);
    });

    it("has a null scopeUrl and empty assets when no bug_bounty row exists at all", async () => {
      const target = await createSecurityTarget({ slug: "test-scope-url-none", name: "T" });

      const rows = await listSecurityTargetPriority();
      const row = findBySlug(rows, target.slug);

      expect(row.actionability.scopeUrl).toBeNull();
      expect(row.actionability.assets).toEqual([]);
      expect(row.actionability.totalAssetCount).toBe(0);
    });

    it("includes a source-order example asset in nextAction when real detail is available", async () => {
      const target = await createSecurityTarget({
        slug: "test-scope-next-action-example",
        name: "T",
      });
      await upsertBugBounty({
        securityTargetId: target.id,
        platform: "immunefi",
        status: "active",
      });
      await insertBountyProgramEvent({
        securityTargetId: target.id,
        occurredAt: BASE_DATE,
        smartContractAssetIds: ["asset-2", "asset-1"],
        assets: [
          {
            id: "asset-1",
            type: "smart_contract",
            description: "Second.sol",
            url: "https://a/Second.sol",
          },
          {
            id: "asset-2",
            type: "smart_contract",
            description: "First.sol",
            url: "https://a/First.sol",
          },
        ],
      });

      const rows = await listSecurityTargetPriority();
      const row = findBySlug(rows, target.slug);

      // Source order (as stored in `assets`), not the
      // `smartContractAssetIds` order — `smartContractAssetIds` lists
      // asset-2 first, but the first `assets` entry is "Second.sol"
      // (asset-1), so that is the example that must be picked.
      expect(row.researchReadiness.nextAction).toContain('"Second.sol"');
      expect(row.researchReadiness.nextAction).toContain("https://a/Second.sol");
    });

    it("omits the example clause in nextAction when no asset detail is available", async () => {
      const target = await createSecurityTarget({
        slug: "test-scope-next-action-no-example",
        name: "T",
      });
      await upsertBugBounty({
        securityTargetId: target.id,
        platform: "immunefi",
        status: "active",
      });
      await insertBountyProgramEvent({
        securityTargetId: target.id,
        occurredAt: BASE_DATE,
        smartContractAssetIds: ["asset-1"],
      });

      const rows = await listSecurityTargetPriority();
      const row = findBySlug(rows, target.slug);

      expect(row.researchReadiness.nextAction).not.toContain("for example");
      expect(row.researchReadiness.nextAction).toMatch(/1 smart-contract asset/i);
    });

    it("never changes tier, isActionable, or researchReadiness.status as a result of exposing asset detail", async () => {
      const target = await createSecurityTarget({ slug: "test-scope-no-regression", name: "T" });
      await seedSignal({ securityTargetId: target.id, signalType: "bounty-scope-expanded" });
      await upsertBugBounty({
        securityTargetId: target.id,
        platform: "immunefi",
        status: "active",
      });
      await insertBountyProgramEvent({
        securityTargetId: target.id,
        occurredAt: BASE_DATE,
        smartContractAssetIds: ["asset-1"],
        assets: [{ id: "asset-1", type: "smart_contract", description: "V", url: "https://a" }],
      });

      const rows = await listSecurityTargetPriority();
      const row = findBySlug(rows, target.slug);

      expect(row.tier).toBe("A");
      expect(row.actionability.isActionable).toBe(true);
      expect(row.researchReadiness.status).toBe("ready");
    });
  });

  describe("listSecurityTargetPriority — research readiness", () => {
    it("is ready for an actionable bounty with no qualifying signal at all", async () => {
      const target = await createSecurityTarget({
        slug: "test-readiness-ready-no-signal",
        name: "T",
      });
      await upsertBugBounty({
        securityTargetId: target.id,
        platform: "immunefi",
        status: "active",
      });
      await insertBountyProgramEvent({
        securityTargetId: target.id,
        occurredAt: BASE_DATE,
        smartContractAssetIds: ["asset-1", "asset-2"],
      });

      const rows = await listSecurityTargetPriority();
      const row = findBySlug(rows, target.slug);

      expect(row.tier).toBe("C");
      expect(row.researchReadiness.status).toBe("ready");
      expect(row.researchReadiness.nextAction).toMatch(/2 smart-contract asset/i);
    });

    it("is ready for an actionable bounty even when a qualifying signal is also present", async () => {
      const target = await createSecurityTarget({
        slug: "test-readiness-ready-with-signal",
        name: "T",
      });
      await seedSignal({ securityTargetId: target.id, signalType: "bounty-scope-expanded" });
      await upsertBugBounty({
        securityTargetId: target.id,
        platform: "immunefi",
        status: "active",
      });
      await insertBountyProgramEvent({
        securityTargetId: target.id,
        occurredAt: BASE_DATE,
        smartContractAssetIds: ["asset-1"],
      });

      const rows = await listSecurityTargetPriority();
      const row = findBySlug(rows, target.slug);

      expect(row.tier).toBe("A");
      expect(row.researchReadiness.status).toBe("ready");
    });

    it("is insufficient-evidence, not ready, for a historical qualifying signal with no current bounty", async () => {
      const target = await createSecurityTarget({
        slug: "test-readiness-signal-no-bounty",
        name: "T",
      });
      await seedSignal({ securityTargetId: target.id, signalType: "tvl-growth" });

      const rows = await listSecurityTargetPriority();
      const row = findBySlug(rows, target.slug);

      expect(row.researchReadiness.status).toBe("insufficient-evidence");
      expect(row.researchReadiness.reason).toMatch(/tvl-growth/);
      expect(row.researchReadiness.nextAction).toBeNull();
    });

    it("is no-current-route, not insufficient-evidence, when repository evidence exists alone", async () => {
      const target = await createSecurityTarget({
        slug: "test-readiness-repo-alone",
        name: "T",
        repositoryUrl: "https://github.com/acme",
      });

      const rows = await listSecurityTargetPriority();
      const row = findBySlug(rows, target.slug);

      expect(row.researchReadiness.status).toBe("no-current-route");
      expect(row.researchReadiness.nextAction).toBeNull();
    });

    it("is no-current-route, not insufficient-evidence, when audit evidence exists alone", async () => {
      const target = await createSecurityTarget({ slug: "test-readiness-audit-alone", name: "T" });
      await insertBountyProgramEvent({
        securityTargetId: target.id,
        occurredAt: BASE_DATE,
        audits: [{ id: "audit-1", url: null, auditor: "Acme Audits", date: "2024-01-01" }],
      });

      const rows = await listSecurityTargetPriority();
      const row = findBySlug(rows, target.slug);

      expect(row.audit.status).toBe("present");
      expect(row.researchReadiness.status).toBe("no-current-route");
      expect(row.researchReadiness.nextAction).toBeNull();
    });

    it("is not actionable (and not ready) for an expired bounty, falling back to the signal/no-signal rule", async () => {
      const target = await createSecurityTarget({ slug: "test-readiness-expired", name: "T" });
      await seedSignal({ securityTargetId: target.id, signalType: "audit-coverage-gap" });
      await upsertBugBounty({
        securityTargetId: target.id,
        platform: "immunefi",
        status: "active",
      });
      const pastEndDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      await insertBountyProgramEvent({
        securityTargetId: target.id,
        occurredAt: BASE_DATE,
        smartContractAssetIds: ["asset-1"],
        endDate: pastEndDate,
      });

      const rows = await listSecurityTargetPriority();
      const row = findBySlug(rows, target.slug);

      expect(row.actionability.isActionable).toBe(false);
      expect(row.researchReadiness.status).toBe("insufficient-evidence");
    });

    it("is not actionable (and not ready) for a paused bounty, falling back to the signal/no-signal rule", async () => {
      const target = await createSecurityTarget({ slug: "test-readiness-paused", name: "T" });
      await upsertBugBounty({
        securityTargetId: target.id,
        platform: "immunefi",
        status: "paused",
      });
      await insertBountyProgramEvent({
        securityTargetId: target.id,
        occurredAt: BASE_DATE,
        smartContractAssetIds: ["asset-1"],
      });

      const rows = await listSecurityTargetPriority();
      const row = findBySlug(rows, target.slug);

      expect(row.actionability.isActionable).toBe(false);
      expect(row.researchReadiness.status).toBe("no-current-route");
    });

    it("never invents an asset-level nextAction when the known asset count is zero", async () => {
      const target = await createSecurityTarget({ slug: "test-readiness-zero-assets", name: "T" });
      await upsertBugBounty({
        securityTargetId: target.id,
        platform: "immunefi",
        status: "active",
      });
      await insertBountyProgramEvent({
        securityTargetId: target.id,
        occurredAt: BASE_DATE,
        smartContractAssetIds: [],
      });

      const rows = await listSecurityTargetPriority();
      const row = findBySlug(rows, target.slug);

      expect(row.actionability.isActionable).toBe(false);
      expect(row.researchReadiness.status).toBe("no-current-route");
      expect(row.researchReadiness.nextAction).toBeNull();
    });

    it("is deterministic and stable across repeated reads with no intervening writes", async () => {
      const target = await createSecurityTarget({ slug: "test-readiness-stable", name: "T" });
      await upsertBugBounty({
        securityTargetId: target.id,
        platform: "immunefi",
        status: "active",
      });
      await insertBountyProgramEvent({
        securityTargetId: target.id,
        occurredAt: BASE_DATE,
        smartContractAssetIds: ["asset-1"],
      });

      const first = await listSecurityTargetPriority();
      const second = await listSecurityTargetPriority();

      expect(findBySlug(first, target.slug).researchReadiness).toEqual(
        findBySlug(second, target.slug).researchReadiness,
      );
    });
  });

  describe("listSecurityTargetPriority — latest-captured-Event ordering", () => {
    it("uses the most recently CAPTURED bounty Event, not the one with the latest self-reported occurredAt", async () => {
      const target = await createSecurityTarget({ slug: "test-ordering-out-of-order", name: "T" });

      // Inserted FIRST (lower id / earlier capture) but carries a LATER
      // self-reported `occurredAt` — simulates a source whose own
      // timestamp is not monotonic with capture order.
      await insertBountyProgramEvent({
        securityTargetId: target.id,
        occurredAt: new Date("2026-06-01T00:00:00Z"),
        smartContractAssetIds: ["stale-asset"],
        endDate: null,
      });

      // Inserted SECOND (higher id / later capture) but carries an
      // EARLIER self-reported `occurredAt`.
      await insertBountyProgramEvent({
        securityTargetId: target.id,
        occurredAt: new Date("2026-01-01T00:00:00Z"),
        smartContractAssetIds: ["current-asset"],
        endDate: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      });

      await upsertBugBounty({
        securityTargetId: target.id,
        platform: "immunefi",
        status: "active",
      });

      const rows = await listSecurityTargetPriority();
      const row = findBySlug(rows, target.slug);

      // The more recently *captured* Event (second insert) must win: its
      // endDate is in the past, so the bounty must read as expired/not
      // actionable, not as actionable via the first (stale) Event's
      // null endDate.
      expect(row.actionability.isActionable).toBe(false);
      expect(row.actionability.reason).toMatch(/already concluded/i);
    });
  });

  describe("listSecurityTargetPriority — identity evidence and Opportunity presence", () => {
    it("represents a missing repositoryUrl honestly as null, never fabricated", async () => {
      const target = await createSecurityTarget({ slug: "test-identity-missing", name: "T" });

      const rows = await listSecurityTargetPriority();
      const row = findBySlug(rows, target.slug);

      expect(row.identity.repositoryUrl).toBeNull();
    });

    it("surfaces the stored repositoryUrl when present", async () => {
      const target = await createSecurityTarget({
        slug: "test-identity-present",
        name: "T",
        repositoryUrl: "https://github.com/acme",
      });

      const rows = await listSecurityTargetPriority();
      const row = findBySlug(rows, target.slug);

      expect(row.identity.repositoryUrl).toBe("https://github.com/acme");
    });

    it("reflects lastSignalAt from the Intelligence projection, reused as-is", async () => {
      const target = await createSecurityTarget({ slug: "test-last-signal-at", name: "T" });
      const asOf = new Date("2026-02-01T00:00:00Z");
      await upsertSecurityTargetIntelligence({
        securityTargetId: target.id,
        trend: "stable",
        confidence: 0.4,
        signalCount: 1,
        lastSignalAt: asOf,
        asOf,
      });

      const rows = await listSecurityTargetPriority();
      const row = findBySlug(rows, target.slug);

      expect(row.lastSignalAt).toBe(asOf.toISOString());
    });

    it("sets hasOpportunity true once a Security Opportunity row exists for the target", async () => {
      const target = await createSecurityTarget({ slug: "test-has-opportunity", name: "T" });
      await seedSignal({ securityTargetId: target.id, signalType: "tvl-growth" });
      await getDb().insert(schema.securityOpportunity).values({
        id: randomUUID(),
        securityTargetId: target.id,
        opportunityType: "active-protocol",
        detectionWindow: "2026-W01",
        reasoning: "test",
        detectedAt: BASE_DATE,
      });

      const rows = await listSecurityTargetPriority();
      const row = findBySlug(rows, target.slug);

      expect(row.hasOpportunity).toBe(true);
      // An Opportunity's existence is independent of tier — Tier B here is
      // still driven solely by the qualifying Signal, not by this flag.
      expect(row.tier).toBe("B");
    });
  });

  describe("listSecurityTargetPriority — qualifyingSignalIds and opportunityReasoning", () => {
    it("passes opportunityReasoning through exactly as stored, never rewritten", async () => {
      const target = await createSecurityTarget({ slug: "test-reasoning-passthrough", name: "T" });
      await seedSignal({ securityTargetId: target.id, signalType: "tvl-growth" });
      const storedReasoning =
        "Detected: qualifying signal type(s) [tvl-growth], 1 total signal(s), confidence 0.30, " +
        "trend insufficient-data, within window 2026-W01. Unscored.";
      await getDb().insert(schema.securityOpportunity).values({
        id: randomUUID(),
        securityTargetId: target.id,
        opportunityType: "active-protocol",
        detectionWindow: "2026-W01",
        reasoning: storedReasoning,
        detectedAt: BASE_DATE,
      });

      const rows = await listSecurityTargetPriority();
      const row = findBySlug(rows, target.slug);

      expect(row.opportunityReasoning).toBe(storedReasoning);
    });

    it("returns opportunityReasoning: null and an empty qualifyingSignalIds array when no Opportunity exists", async () => {
      const target = await createSecurityTarget({
        slug: "test-reasoning-no-opportunity",
        name: "T",
      });

      const rows = await listSecurityTargetPriority();
      const row = findBySlug(rows, target.slug);

      expect(row.hasOpportunity).toBe(false);
      expect(row.opportunityReasoning).toBeNull();
      expect(row.qualifyingSignalIds).toEqual([]);
    });

    it("exposes exactly the ids of the qualifying Signals, not every Signal for the target", async () => {
      const target = await createSecurityTarget({ slug: "test-qualifying-ids-subset", name: "T" });
      // Non-qualifying — must never appear in qualifyingSignalIds.
      await seedSignal({ securityTargetId: target.id, signalType: "new-protocol" });
      const qualifyingOne = await seedSignal({
        securityTargetId: target.id,
        signalType: "tvl-growth",
      });
      const qualifyingTwo = await seedSignal({
        securityTargetId: target.id,
        signalType: "audit-coverage-gap",
      });
      await getDb().insert(schema.securityOpportunity).values({
        id: randomUUID(),
        securityTargetId: target.id,
        opportunityType: "active-protocol",
        detectionWindow: "2026-W01",
        reasoning: "test",
        detectedAt: BASE_DATE,
      });

      const rows = await listSecurityTargetPriority();
      const row = findBySlug(rows, target.slug);

      expect(new Set(row.qualifyingSignalIds)).toEqual(
        new Set([qualifyingOne.id, qualifyingTwo.id]),
      );
      expect(row.qualifyingSignalIds).toHaveLength(2);
    });

    it("every exposed id resolves to a real security_signal row for the correct target", async () => {
      const target = await createSecurityTarget({ slug: "test-qualifying-ids-resolve", name: "T" });
      const qualifying = await seedSignal({
        securityTargetId: target.id,
        signalType: "tvl-growth",
      });

      const rows = await listSecurityTargetPriority();
      const row = findBySlug(rows, target.slug);

      expect(row.qualifyingSignalIds).toEqual([qualifying.id]);

      const [resolved] = await getDb()
        .select()
        .from(schema.securitySignal)
        .where(eq(schema.securitySignal.id, row.qualifyingSignalIds[0]!));
      expect(resolved?.securityTargetId).toBe(target.id);
      expect(resolved?.signalType).toBe("tvl-growth");
    });

    it("never leaks a qualifying Signal belonging to a different target", async () => {
      const targetA = await createSecurityTarget({
        slug: "test-qualifying-ids-target-a",
        name: "A",
      });
      const targetB = await createSecurityTarget({
        slug: "test-qualifying-ids-target-b",
        name: "B",
      });
      const signalA = await seedSignal({ securityTargetId: targetA.id, signalType: "tvl-growth" });
      await seedSignal({ securityTargetId: targetB.id, signalType: "tvl-growth" });

      const rows = await listSecurityTargetPriority();
      const rowA = findBySlug(rows, targetA.slug);

      expect(rowA.qualifyingSignalIds).toEqual([signalA.id]);
    });

    it("picks the most recently detected Opportunity's reasoning when multiple rows exist for one target", async () => {
      const target = await createSecurityTarget({ slug: "test-multiple-opportunities", name: "T" });
      await seedSignal({ securityTargetId: target.id, signalType: "tvl-growth" });
      await getDb()
        .insert(schema.securityOpportunity)
        .values([
          {
            id: randomUUID(),
            securityTargetId: target.id,
            opportunityType: "active-protocol",
            detectionWindow: "2026-W01",
            reasoning: "older window reasoning",
            detectedAt: new Date("2026-01-01T00:00:00Z"),
          },
          {
            id: randomUUID(),
            securityTargetId: target.id,
            opportunityType: "active-protocol",
            detectionWindow: "2026-W02",
            reasoning: "newer window reasoning",
            detectedAt: new Date("2026-01-08T00:00:00Z"),
          },
        ]);

      const rows = await listSecurityTargetPriority();
      const row = findBySlug(rows, target.slug);

      expect(row.opportunityReasoning).toBe("newer window reasoning");
    });

    it("leaves tier, actionability, and researchReadiness unchanged by these additions", async () => {
      const target = await createSecurityTarget({
        slug: "test-reasoning-no-regression",
        name: "T",
      });
      await seedSignal({ securityTargetId: target.id, signalType: "bounty-scope-expanded" });
      await upsertBugBounty({
        securityTargetId: target.id,
        platform: "immunefi",
        status: "active",
      });
      await insertBountyProgramEvent({
        securityTargetId: target.id,
        occurredAt: BASE_DATE,
        smartContractAssetIds: ["asset-1"],
      });
      await getDb().insert(schema.securityOpportunity).values({
        id: randomUUID(),
        securityTargetId: target.id,
        opportunityType: "active-protocol",
        detectionWindow: "2026-W01",
        reasoning: "test",
        detectedAt: BASE_DATE,
      });

      const rows = await listSecurityTargetPriority();
      const row = findBySlug(rows, target.slug);

      expect(row.tier).toBe("A");
      expect(row.actionability.isActionable).toBe(true);
      expect(row.researchReadiness.status).toBe("ready");
    });
  });

  describe("listSecurityTargetPriority — stability", () => {
    it("returns the same result on repeated calls with no intervening writes", async () => {
      const target = await createSecurityTarget({ slug: "test-stable-repeat", name: "T" });
      await seedSignal({ securityTargetId: target.id, signalType: "bounty-scope-expanded" });

      const first = await listSecurityTargetPriority();
      const second = await listSecurityTargetPriority();

      expect(findBySlug(first, target.slug)).toEqual(findBySlug(second, target.slug));
    });

    it("orders results deterministically by slug", async () => {
      const rows = await listSecurityTargetPriority();
      const slugs = rows.map((r) => r.slug);
      const sorted = [...slugs].sort();
      expect(slugs).toEqual(sorted);
    });
  });

  describe("listSecurityTargetPriority — multi-window, multi-poll lifecycle (real pipeline)", () => {
    it("reflects a second real pipeline evaluation in a later detection window without duplicating the first Opportunity or its Signals", async () => {
      const target = await createSecurityTarget({ slug: "test-lifecycle-multi-window", name: "T" });

      // --- Poll 1: 2026-01-05 (a Monday, ISO week 2026-W02). TVL $10M,
      // audits "0" — qualifies AUDIT_COVERAGE_GAP on its own.
      const poll1At = new Date("2026-01-05T00:00:00Z");
      await insertProtocolSnapshotEvent({
        securityTargetId: target.id,
        occurredAt: poll1At,
        tvl: 10_000_000,
      });

      const run1 = await runSecurityScoringPipeline(target.id);
      expect(run1.eventsProcessed).toBe(1);
      expect(run1.opportunitiesDetected).toBe(1);

      const signalsAfterPoll1 = await getDb()
        .select()
        .from(schema.securitySignal)
        .where(eq(schema.securitySignal.securityTargetId, target.id));
      // new-protocol (non-qualifying) + audit-coverage-gap (qualifying).
      expect(signalsAfterPoll1.map((s) => s.signalType).sort()).toEqual([
        "audit-coverage-gap",
        "new-protocol",
      ]);

      const opportunitiesAfterPoll1 = await getDb()
        .select()
        .from(schema.securityOpportunity)
        .where(eq(schema.securityOpportunity.securityTargetId, target.id));
      expect(opportunitiesAfterPoll1).toHaveLength(1);
      expect(opportunitiesAfterPoll1[0]?.detectionWindow).toBe("2026-W02");

      // --- Poll 2: 2026-01-12 (a week later, ISO week 2026-W03). TVL
      // grows meaningfully — qualifies TVL_GROWTH too, in a NEW window.
      const poll2At = new Date("2026-01-12T00:00:00Z");
      await insertProtocolSnapshotEvent({
        securityTargetId: target.id,
        occurredAt: poll2At,
        type: "ProtocolSnapshotUpdated",
        tvl: 15_000_000,
        changedFrom: { tvl: 10_000_000 },
      });

      const run2 = await runSecurityScoringPipeline(target.id);
      expect(run2.eventsProcessed).toBe(1);
      expect(run2.opportunitiesDetected).toBe(1);

      const opportunitiesAfterPoll2 = await getDb()
        .select()
        .from(schema.securityOpportunity)
        .where(eq(schema.securityOpportunity.securityTargetId, target.id));
      // A second, distinct Opportunity row for the new window — the
      // first window's row is neither duplicated nor overwritten.
      expect(opportunitiesAfterPoll2).toHaveLength(2);
      expect(opportunitiesAfterPoll2.map((o) => o.detectionWindow).sort()).toEqual([
        "2026-W02",
        "2026-W03",
      ]);
      const firstWindowRow = opportunitiesAfterPoll2.find((o) => o.detectionWindow === "2026-W02");
      expect(firstWindowRow?.id).toBe(opportunitiesAfterPoll1[0]?.id);

      const signalsAfterPoll2 = await getDb()
        .select()
        .from(schema.securitySignal)
        .where(eq(schema.securitySignal.securityTargetId, target.id));
      // The original two Signal rows are untouched; two new ones appear
      // (a second audit-coverage-gap on the Updated Event, plus tvl-growth).
      expect(signalsAfterPoll2).toHaveLength(4);
      expect(signalsAfterPoll1.every((s1) => signalsAfterPoll2.some((s2) => s2.id === s1.id))).toBe(
        true,
      );

      // --- Real DTO call after the second evaluation ---
      const rows = await listSecurityTargetPriority();
      const row = findBySlug(rows, target.slug);

      expect(row.hasOpportunity).toBe(true);

      const qualifyingSignalRows = signalsAfterPoll2.filter((s) =>
        ["audit-coverage-gap", "tvl-growth"].includes(s.signalType),
      );
      expect(new Set(row.qualifyingSignalIds)).toEqual(
        new Set(qualifyingSignalRows.map((s) => s.id)),
      );
      expect(row.qualifyingSignalIds).toHaveLength(3); // 2x audit-coverage-gap + 1x tvl-growth
      // No duplicates, and no non-qualifying Signal id present.
      expect(new Set(row.qualifyingSignalIds).size).toBe(row.qualifyingSignalIds.length);
      const newProtocolSignal = signalsAfterPoll2.find((s) => s.signalType === "new-protocol");
      expect(row.qualifyingSignalIds).not.toContain(newProtocolSignal?.id);

      // opportunityReasoning must match the most recently detected row
      // (2026-W03) exactly, not the first window's.
      const mostRecentOpportunity = opportunitiesAfterPoll2.find(
        (o) => o.detectionWindow === "2026-W03",
      );
      expect(row.opportunityReasoning).toBe(mostRecentOpportunity?.reasoning);

      // Stable on a repeated DTO query with no intervening writes.
      const rowsAgain = await listSecurityTargetPriority();
      expect(findBySlug(rowsAgain, target.slug)).toEqual(row);
    });
  });

  describe("listSecurityTargetPriorityPage — classification parity with listSecurityTargetPriority", () => {
    it("derives identical tier, tierReason, researchReadiness, hasOpportunity, and lastSignalAt for a fixture covering every tier and readiness state", async () => {
      // Tier A, ready: a qualifying, artifact-naming Signal AND an
      // active, non-expired, in-scope bounty.
      const tierAReady = await createSecurityTarget({ slug: "parity-tier-a-ready", name: "T" });
      await seedSignal({ securityTargetId: tierAReady.id, signalType: "bounty-scope-expanded" });
      await upsertBugBounty({
        securityTargetId: tierAReady.id,
        platform: "immunefi",
        status: "active",
      });
      await insertBountyProgramEvent({
        securityTargetId: tierAReady.id,
        occurredAt: BASE_DATE,
        smartContractAssetIds: ["asset-1"],
      });
      await upsertSecurityTargetIntelligence({
        securityTargetId: tierAReady.id,
        trend: "stable",
        confidence: 0.5,
        signalCount: 1,
        lastSignalAt: new Date("2026-03-01T00:00:00Z"),
        asOf: new Date("2026-03-01T00:00:00Z"),
      });
      await getDb().insert(schema.securityOpportunity).values({
        id: randomUUID(),
        securityTargetId: tierAReady.id,
        opportunityType: "active-protocol",
        detectionWindow: "2026-W09",
        reasoning: "parity fixture: tier A, ready, has Opportunity",
        detectedAt: BASE_DATE,
      });

      // Tier B, insufficient-evidence: a qualifying but non-artifact
      // Signal, no bounty at all (audit evidence therefore "unavailable").
      const tierBInsufficient = await createSecurityTarget({
        slug: "parity-tier-b-insufficient",
        name: "T",
      });
      await seedSignal({ securityTargetId: tierBInsufficient.id, signalType: "tvl-growth" });
      await getDb().insert(schema.securityOpportunity).values({
        id: randomUUID(),
        securityTargetId: tierBInsufficient.id,
        opportunityType: "active-protocol",
        detectionWindow: "2026-W09",
        reasoning: "parity fixture: tier B, insufficient-evidence, has Opportunity",
        detectedAt: BASE_DATE,
      });

      // Tier C, no-current-route: only a non-qualifying Signal, no
      // bounty, no Opportunity.
      const tierCNoRoute = await createSecurityTarget({
        slug: "parity-tier-c-no-route",
        name: "T",
      });
      await seedSignal({ securityTargetId: tierCNoRoute.id, signalType: "new-protocol" });

      // Tier C, ready: zero Signals at all, but an active bounty with
      // in-scope assets — proves tier and readiness vary independently.
      const tierCReady = await createSecurityTarget({ slug: "parity-tier-c-ready", name: "T" });
      await upsertBugBounty({
        securityTargetId: tierCReady.id,
        platform: "immunefi",
        status: "active",
      });
      await insertBountyProgramEvent({
        securityTargetId: tierCReady.id,
        occurredAt: BASE_DATE,
        smartContractAssetIds: ["asset-1"],
      });

      // Paused bounty, no Signal: no-current-route, distinct from the
      // "no bounty at all" case.
      const pausedNoRoute = await createSecurityTarget({
        slug: "parity-paused-no-route",
        name: "T",
      });
      await upsertBugBounty({
        securityTargetId: pausedNoRoute.id,
        platform: "immunefi",
        status: "paused",
      });

      // A target with genuinely no data of any kind — the baseline
      // discovery-only case.
      const bareDiscovery = await createSecurityTarget({
        slug: "parity-bare-discovery",
        name: "T",
      });

      const fixtureSlugs = [
        tierAReady.slug,
        tierBInsufficient.slug,
        tierCNoRoute.slug,
        tierCReady.slug,
        pausedNoRoute.slug,
        bareDiscovery.slug,
      ];

      const fullRows = await listSecurityTargetPriority();
      const pagedRows = await listSecurityTargetPriorityPage({
        page: 1,
        pageSize: 100_000,
        sort: "slug",
      });

      // The fixture must actually exercise every state it claims to —
      // otherwise this test could pass vacuously.
      const fullBySlug = new Map(fullRows.map((r) => [r.slug, r]));
      expect(fullBySlug.get(tierAReady.slug)?.tier).toBe("A");
      expect(fullBySlug.get(tierAReady.slug)?.researchReadiness.status).toBe("ready");
      expect(fullBySlug.get(tierBInsufficient.slug)?.tier).toBe("B");
      expect(fullBySlug.get(tierBInsufficient.slug)?.researchReadiness.status).toBe(
        "insufficient-evidence",
      );
      expect(fullBySlug.get(tierCNoRoute.slug)?.tier).toBe("C");
      expect(fullBySlug.get(tierCNoRoute.slug)?.researchReadiness.status).toBe("no-current-route");
      expect(fullBySlug.get(tierCReady.slug)?.tier).toBe("C");
      expect(fullBySlug.get(tierCReady.slug)?.researchReadiness.status).toBe("ready");
      expect(fullBySlug.get(pausedNoRoute.slug)?.researchReadiness.status).toBe("no-current-route");
      expect(fullBySlug.get(bareDiscovery.slug)?.tier).toBe("C");

      for (const slug of fixtureSlugs) {
        const fromFull = fullBySlug.get(slug);
        const fromPaged = pagedRows.items.find((r) => r.slug === slug);
        expect(fromFull).toBeDefined();
        expect(fromPaged).toBeDefined();
        expect(fromPaged?.tier).toBe(fromFull?.tier);
        expect(fromPaged?.tierReason).toBe(fromFull?.tierReason);
        expect(fromPaged?.researchReadiness).toEqual(fromFull?.researchReadiness);
        expect(fromPaged?.hasOpportunity).toBe(fromFull?.hasOpportunity);
        expect(fromPaged?.lastSignalAt).toBe(fromFull?.lastSignalAt);
      }
    });
  });

  describe("listSecurityTargetPriorityPage — pagination", () => {
    it("pages through a known fixture with no duplicates and correct totals, including a final partial page", async () => {
      const fixtureSlugs: string[] = [];
      for (let i = 0; i < 5; i += 1) {
        const target = await createSecurityTarget({ slug: `page-fixture-${i}`, name: "T" });
        await seedSignal({ securityTargetId: target.id, signalType: "bounty-scope-expanded" });
        fixtureSlugs.push(target.slug);
      }

      // Page through every Tier A result (my fixture is guaranteed to be
      // Tier A; other tests may also have produced Tier A targets, so
      // this asserts relative correctness — no duplicates, every fixture
      // slug present exactly once — rather than an absolute total count).
      const firstPage = await listSecurityTargetPriorityPage({
        page: 1,
        pageSize: 2,
        tier: "A",
        sort: "slug",
      });
      const totalCount = firstPage.totalCount;
      const totalPages = firstPage.totalPages;
      expect(totalPages).toBe(Math.ceil(totalCount / 2));

      const seenSlugs: string[] = [];
      for (let page = 1; page <= totalPages; page += 1) {
        const result = await listSecurityTargetPriorityPage({
          page,
          pageSize: 2,
          tier: "A",
          sort: "slug",
        });
        expect(result.totalCount).toBe(totalCount);
        expect(result.totalPages).toBe(totalPages);
        if (page < totalPages) {
          expect(result.items).toHaveLength(2);
        } else {
          // Final page may be partial.
          expect(result.items.length).toBeGreaterThan(0);
          expect(result.items.length).toBeLessThanOrEqual(2);
        }
        seenSlugs.push(...result.items.map((r) => r.slug));
      }

      expect(new Set(seenSlugs).size).toBe(seenSlugs.length); // no duplicates across pages
      expect(seenSlugs).toHaveLength(totalCount);
      for (const slug of fixtureSlugs) {
        expect(seenSlugs).toContain(slug);
      }
    });

    it("returns an empty item list with accurate counts for an out-of-range page", async () => {
      const result = await listSecurityTargetPriorityPage({
        page: 999_999,
        pageSize: 20,
        sort: "slug",
      });
      expect(result.items).toEqual([]);
      expect(result.page).toBe(999_999);
      expect(result.totalCount).toBeGreaterThanOrEqual(0);
    });

    it("returns a valid zero-result page when a filter matches nothing", async () => {
      // No target in any test fixture across this file carries a bounty
      // that is both active, non-expired, and in-scope AND has zero
      // qualifying Signals AND... — instead, use a combination that is
      // structurally impossible by the DTO's own rule: tier A requires a
      // qualifying, artifact-naming Signal, which by definition means
      // `qualifyingSignalTypes` is non-empty, so `readiness` can never be
      // "no-current-route" for a Tier A target (that status requires
      // zero qualifying Signals). This is a real, permanently-empty
      // combination under the existing business rules, not a fragile
      // fixture-dependent one.
      const result = await listSecurityTargetPriorityPage({
        page: 1,
        pageSize: 20,
        tier: "A",
        readiness: "no-current-route",
        sort: "slug",
      });
      expect(result.items).toEqual([]);
      expect(result.totalCount).toBe(0);
      expect(result.totalPages).toBe(0);
    });

    it("honors pageSize schema bounds via securityTargetFeedQuerySchema defaults, minimum, and maximum", () => {
      expect(securityTargetFeedQuerySchema.parse({})).toMatchObject({
        page: 1,
        pageSize: 20,
        sort: "slug",
      });
      expect(securityTargetFeedQuerySchema.parse({ pageSize: 1 }).pageSize).toBe(1);
      expect(securityTargetFeedQuerySchema.parse({ pageSize: 100 }).pageSize).toBe(100);
      expect(() => securityTargetFeedQuerySchema.parse({ pageSize: 0 })).toThrow();
      expect(() => securityTargetFeedQuerySchema.parse({ pageSize: 101 })).toThrow();
      expect(() => securityTargetFeedQuerySchema.parse({ page: 0 })).toThrow();
    });
  });

  describe("listSecurityTargetPriorityPage — filters", () => {
    it("filters by tier independently, returning only matching targets", async () => {
      const tierATarget = await createSecurityTarget({ slug: "filter-tier-a", name: "T" });
      await seedSignal({ securityTargetId: tierATarget.id, signalType: "bounty-scope-expanded" });

      const tierBTarget = await createSecurityTarget({ slug: "filter-tier-b", name: "T" });
      await seedSignal({ securityTargetId: tierBTarget.id, signalType: "tvl-growth" });

      const tierCTarget = await createSecurityTarget({ slug: "filter-tier-c", name: "T" });

      for (const tier of ["A", "B", "C"] as const) {
        const result = await listSecurityTargetPriorityPage({
          page: 1,
          pageSize: 1000,
          tier,
          sort: "slug",
        });
        expect(result.items.every((r) => r.tier === tier)).toBe(true);
      }

      const tierAResult = await listSecurityTargetPriorityPage({
        page: 1,
        pageSize: 1000,
        tier: "A",
        sort: "slug",
      });
      expect(tierAResult.items.some((r) => r.slug === tierATarget.slug)).toBe(true);
      expect(tierAResult.items.some((r) => r.slug === tierBTarget.slug)).toBe(false);
      expect(tierAResult.items.some((r) => r.slug === tierCTarget.slug)).toBe(false);
    });

    it("filters by readiness independently, returning only matching targets", async () => {
      const readyTarget = await createSecurityTarget({ slug: "filter-ready", name: "T" });
      await upsertBugBounty({
        securityTargetId: readyTarget.id,
        platform: "immunefi",
        status: "active",
      });
      await insertBountyProgramEvent({
        securityTargetId: readyTarget.id,
        occurredAt: BASE_DATE,
        smartContractAssetIds: ["asset-1"],
      });

      const insufficientTarget = await createSecurityTarget({
        slug: "filter-insufficient",
        name: "T",
      });
      await seedSignal({ securityTargetId: insufficientTarget.id, signalType: "tvl-growth" });

      const noRouteTarget = await createSecurityTarget({ slug: "filter-no-route", name: "T" });

      for (const readiness of ["ready", "insufficient-evidence", "no-current-route"] as const) {
        const result = await listSecurityTargetPriorityPage({
          page: 1,
          pageSize: 1000,
          readiness,
          sort: "slug",
        });
        expect(result.items.every((r) => r.researchReadiness.status === readiness)).toBe(true);
      }

      const readyResult = await listSecurityTargetPriorityPage({
        page: 1,
        pageSize: 1000,
        readiness: "ready",
        sort: "slug",
      });
      expect(readyResult.items.some((r) => r.slug === readyTarget.slug)).toBe(true);
      expect(readyResult.items.some((r) => r.slug === insufficientTarget.slug)).toBe(false);
      expect(readyResult.items.some((r) => r.slug === noRouteTarget.slug)).toBe(false);
    });

    it("combines tier and readiness filters with AND semantics", async () => {
      // Tier A + ready: both a qualifying artifact-naming Signal and an
      // actionable bounty.
      const tierAReady = await createSecurityTarget({ slug: "filter-combo-a-ready", name: "T" });
      await seedSignal({ securityTargetId: tierAReady.id, signalType: "bounty-scope-expanded" });
      await upsertBugBounty({
        securityTargetId: tierAReady.id,
        platform: "immunefi",
        status: "active",
      });
      await insertBountyProgramEvent({
        securityTargetId: tierAReady.id,
        occurredAt: BASE_DATE,
        smartContractAssetIds: ["asset-1"],
      });

      // Tier A, but NOT ready (no bounty at all) — must be excluded by
      // the combined filter even though it matches `tier` alone.
      const tierANotReady = await createSecurityTarget({
        slug: "filter-combo-a-not-ready",
        name: "T",
      });
      await seedSignal({ securityTargetId: tierANotReady.id, signalType: "bounty-scope-expanded" });

      const result = await listSecurityTargetPriorityPage({
        page: 1,
        pageSize: 1000,
        tier: "A",
        readiness: "ready",
        sort: "slug",
      });
      expect(result.items.some((r) => r.slug === tierAReady.slug)).toBe(true);
      expect(result.items.some((r) => r.slug === tierANotReady.slug)).toBe(false);
      expect(
        result.items.every((r) => r.tier === "A" && r.researchReadiness.status === "ready"),
      ).toBe(true);
    });

    it("rejects an invalid tier/readiness value via schema validation", () => {
      expect(() => securityTargetFeedQuerySchema.parse({ tier: "Z" })).toThrow();
      expect(() =>
        securityTargetFeedQuerySchema.parse({ readiness: "confirmed-vulnerability" }),
      ).toThrow();
    });
  });

  describe("listSecurityTargetPriorityPage — sorting and determinism", () => {
    it("sorts by slug ascending by default", async () => {
      const a = await createSecurityTarget({ slug: "sort-slug-aaa", name: "T" });
      const b = await createSecurityTarget({ slug: "sort-slug-bbb", name: "T" });
      const c = await createSecurityTarget({ slug: "sort-slug-ccc", name: "T" });

      const result = await listSecurityTargetPriorityPage({
        page: 1,
        pageSize: 100_000,
        sort: "slug",
      });
      const indexOf = (slug: string) => result.items.findIndex((r) => r.slug === slug);
      expect(indexOf(a.slug)).toBeLessThan(indexOf(b.slug));
      expect(indexOf(b.slug)).toBeLessThan(indexOf(c.slug));
    });

    it("sorts by lastSignalAt descending, with nulls last and a slug tie-breaker", async () => {
      const newer = await createSecurityTarget({ slug: "sort-signal-newer", name: "T" });
      await upsertSecurityTargetIntelligence({
        securityTargetId: newer.id,
        trend: "stable",
        confidence: 0.5,
        signalCount: 1,
        lastSignalAt: new Date("2026-05-01T00:00:00Z"),
        asOf: new Date("2026-05-01T00:00:00Z"),
      });

      const olderTieA = await createSecurityTarget({ slug: "sort-signal-tie-a", name: "T" });
      await upsertSecurityTargetIntelligence({
        securityTargetId: olderTieA.id,
        trend: "stable",
        confidence: 0.5,
        signalCount: 1,
        lastSignalAt: new Date("2026-04-01T00:00:00Z"),
        asOf: new Date("2026-04-01T00:00:00Z"),
      });

      const olderTieB = await createSecurityTarget({ slug: "sort-signal-tie-b", name: "T" });
      await upsertSecurityTargetIntelligence({
        securityTargetId: olderTieB.id,
        trend: "stable",
        confidence: 0.5,
        signalCount: 1,
        lastSignalAt: new Date("2026-04-01T00:00:00Z"), // exact tie with olderTieA
        asOf: new Date("2026-04-01T00:00:00Z"),
      });

      const noSignalAt = await createSecurityTarget({ slug: "sort-signal-null", name: "T" });

      const result = await listSecurityTargetPriorityPage({
        page: 1,
        pageSize: 100_000,
        sort: "lastSignalAt",
      });
      const indexOf = (slug: string) => result.items.findIndex((r) => r.slug === slug);

      // Newer timestamp sorts before older (DESC).
      expect(indexOf(newer.slug)).toBeLessThan(indexOf(olderTieA.slug));
      // Exact ties break by slug ASC: "sort-signal-tie-a" < "sort-signal-tie-b".
      expect(indexOf(olderTieA.slug)).toBeLessThan(indexOf(olderTieB.slug));
      // Null lastSignalAt sorts after every non-null value, regardless
      // of direction.
      expect(indexOf(olderTieB.slug)).toBeLessThan(indexOf(noSignalAt.slug));
    });

    it("returns identical order on a repeated query against a stable fixture", async () => {
      const first = await listSecurityTargetPriorityPage({ page: 1, pageSize: 50, sort: "slug" });
      const second = await listSecurityTargetPriorityPage({ page: 1, pageSize: 50, sort: "slug" });
      expect(second.items.map((r) => r.slug)).toEqual(first.items.map((r) => r.slug));
    });
  });

  describe("getSecurityTargetPriorityBySlug", () => {
    it("returns the full DTO for an existing slug, matching listSecurityTargetPriority's own output exactly", async () => {
      const target = await createSecurityTarget({ slug: "detail-lookup-full", name: "T" });
      await seedSignal({ securityTargetId: target.id, signalType: "bounty-scope-expanded" });
      await seedSignal({ securityTargetId: target.id, signalType: "new-protocol" });
      await upsertBugBounty({
        securityTargetId: target.id,
        platform: "immunefi",
        status: "active",
        scopeUrl: "https://immunefi.com/bug-bounty/detail-lookup-full/",
      });
      await insertBountyProgramEvent({
        securityTargetId: target.id,
        occurredAt: BASE_DATE,
        smartContractAssetIds: ["asset-1"],
        assets: [{ id: "asset-1", type: "smart_contract", description: "Vault", url: "https://a" }],
        audits: [{ id: "audit-1", url: null, auditor: "Acme", date: "2024-01-01" }],
      });
      await getDb().insert(schema.securityOpportunity).values({
        id: randomUUID(),
        securityTargetId: target.id,
        opportunityType: "active-protocol",
        detectionWindow: "2026-W09",
        reasoning: "detail lookup fixture reasoning",
        detectedAt: BASE_DATE,
      });

      const detail = await getSecurityTargetPriorityBySlug(target.slug);
      const fullRows = await listSecurityTargetPriority();
      const fromFull = findBySlug(fullRows, target.slug);

      expect(detail).toEqual(fromFull);
      // Spot-check the fields outside the list summary explicitly.
      expect(detail?.audit.status).toBe("present");
      expect(detail?.actionability.scopeUrl).toBe(
        "https://immunefi.com/bug-bounty/detail-lookup-full/",
      );
      expect(detail?.opportunityReasoning).toBe("detail lookup fixture reasoning");
      expect(detail?.qualifyingSignalIds).toHaveLength(1); // excludes the non-qualifying new-protocol Signal
    });

    it("returns null for an unknown slug", async () => {
      const result = await getSecurityTargetPriorityBySlug("this-slug-does-not-exist-anywhere");
      expect(result).toBeNull();
    });
  });

  describe("listSecurityTargetPriorityPage — query-efficiency structure", () => {
    it("composes full DTOs only for the requested page, not for every target", async () => {
      // Structural verification, not a timing measurement: seed several
      // extra targets, request a small page, and confirm the number of
      // items returned matches the requested page size, not the full
      // target count — proving the response size (and, by the
      // implementation's own structure reviewed in this stage, the
      // Phase 2 composition work) scales with `pageSize`, not with the
      // total number of targets in the database.
      for (let i = 0; i < 8; i += 1) {
        await createSecurityTarget({ slug: `efficiency-fixture-${i}`, name: "T" });
      }

      const allTargets = await listSecurityTargetPriority();
      const page = await listSecurityTargetPriorityPage({ page: 1, pageSize: 3, sort: "slug" });

      expect(allTargets.length).toBeGreaterThan(3);
      expect(page.items).toHaveLength(3);
      expect(page.totalCount).toBe(allTargets.length);
    });
  });
});
