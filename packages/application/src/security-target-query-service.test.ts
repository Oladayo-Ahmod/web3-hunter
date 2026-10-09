import { getDb, schema } from "@web3-hunter/db";
import { createTestDatabase, type TestDatabase } from "@web3-hunter/db/testing";
import {
  createSecurityTarget,
  persistSecuritySignal,
  upsertBugBounty,
  upsertSecurityTargetIntelligence,
} from "@web3-hunter/security";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listSecurityTargetPriority } from "./security-target-query-service";

const BASE_DATE = new Date("2026-01-01T00:00:00Z");

async function insertBountyProgramEvent(input: {
  securityTargetId: string;
  occurredAt: Date;
  audits?: Array<{ id: string; url: string | null; auditor: string | null; date: string | null }>;
  smartContractAssetIds?: string[];
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
      },
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
});
