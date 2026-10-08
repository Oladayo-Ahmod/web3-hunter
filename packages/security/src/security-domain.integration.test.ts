import { getDb, schema } from "@web3-hunter/db";
import { createTestDatabase, type TestDatabase } from "@web3-hunter/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAuditContest, getAuditContestById } from "./audit-contest-store";
import { createBugBounty, getBugBountyById } from "./bug-bounty-store";
import { AUDIT_CONTEST } from "./opportunity-id";
import { createSecurityOpportunity, getSecurityOpportunity } from "./security-opportunity-store";
import { listSecuritySignalsForTarget, persistSecuritySignal } from "./security-signal-store";
import {
  createSecurityTarget,
  getSecurityTargetById,
  getSecurityTargetBySlug,
} from "./security-target-store";
import {
  getSecurityTargetIntelligence,
  upsertSecurityTargetIntelligence,
} from "./security-target-intelligence-store";

describe("Security domain foundation (integration)", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    process.env.DATABASE_URL = testDb.connectionString;
  }, 60_000);

  afterAll(async () => {
    await testDb.stop();
  });

  describe("security_target", () => {
    it("creates a Security Target and reads it back by id and by slug", async () => {
      const created = await createSecurityTarget({
        slug: "example-protocol",
        name: "Example Protocol",
        repositoryUrl: "https://github.com/example/protocol",
        chain: "Ethereum",
        category: "defi",
      });

      expect(created.status).toBe("active");
      expect(await getSecurityTargetById(created.id)).toMatchObject({ slug: "example-protocol" });
      expect(await getSecurityTargetBySlug("example-protocol")).toMatchObject({ id: created.id });
    });

    it("is idempotent by slug: creating the same Security Target again returns the existing row, not a duplicate", async () => {
      const first = await createSecurityTarget({ slug: "idempotent-protocol", name: "First Name" });
      const second = await createSecurityTarget({
        slug: "idempotent-protocol",
        name: "Second Name",
      });

      expect(second.id).toBe(first.id);
      // The already-existing row wins — the second call's "name" is discarded, not applied.
      expect(second.name).toBe("First Name");

      const rows = await getDb()
        .select()
        .from(schema.securityTarget)
        .where(eq(schema.securityTarget.slug, "idempotent-protocol"));
      expect(rows).toHaveLength(1);
    });

    it("optionally links to a Company without requiring one", async () => {
      const [company] = await getDb()
        .insert(schema.company)
        .values({ slug: "security-link-co", name: "Security Link Co" })
        .returning();

      const linked = await createSecurityTarget({
        slug: "linked-protocol",
        name: "Linked Protocol",
        companyId: company!.id,
      });
      const unlinked = await createSecurityTarget({
        slug: "unlinked-protocol",
        name: "Unlinked Protocol",
      });

      expect(linked.companyId).toBe(company!.id);
      expect(unlinked.companyId).toBeNull();
    });
  });

  describe("security_target_intelligence", () => {
    it("upserts the Intelligence projection for a Security Target and reads it back", async () => {
      const target = await createSecurityTarget({ slug: "intel-protocol", name: "Intel Protocol" });
      const asOf = new Date("2026-01-01T00:00:00Z");

      await upsertSecurityTargetIntelligence({
        securityTargetId: target.id,
        trend: "increasing",
        confidence: 0.6,
        signalCount: 2,
        lastSignalAt: asOf,
        asOf,
      });

      const row = await getSecurityTargetIntelligence(target.id);
      expect(row).toMatchObject({ trend: "increasing", confidence: 0.6, signalCount: 2 });
    });

    it("updates in place on a second upsert rather than creating a second row", async () => {
      const target = await createSecurityTarget({
        slug: "intel-update-protocol",
        name: "Intel Update",
      });
      const asOf = new Date("2026-01-01T00:00:00Z");

      await upsertSecurityTargetIntelligence({
        securityTargetId: target.id,
        trend: "insufficient-data",
        confidence: 0.1,
        signalCount: 1,
        asOf,
      });
      await upsertSecurityTargetIntelligence({
        securityTargetId: target.id,
        trend: "increasing",
        confidence: 0.7,
        signalCount: 3,
        asOf: new Date("2026-01-02T00:00:00Z"),
      });

      const rows = await getDb()
        .select()
        .from(schema.securityTargetIntelligence)
        .where(eq(schema.securityTargetIntelligence.securityTargetId, target.id));
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ trend: "increasing", signalCount: 3 });
    });

    it("rejects a confidence value outside 0..1 at the database level", async () => {
      const target = await createSecurityTarget({
        slug: "intel-invalid-protocol",
        name: "Intel Invalid",
      });

      await expect(
        upsertSecurityTargetIntelligence({
          securityTargetId: target.id,
          trend: "increasing",
          confidence: 1.5,
          signalCount: 1,
          asOf: new Date(),
        }),
      ).rejects.toThrow();
    });
  });

  describe("security_signal", () => {
    it("persists a Signal with its source Event references and lists it back for its Security Target", async () => {
      const target = await createSecurityTarget({
        slug: "signal-protocol",
        name: "Signal Protocol",
      });

      await persistSecuritySignal({
        securityTargetId: target.id,
        signalType: "__test__new-deployment",
        weight: 0.5,
        reasoning: "A new deployment was observed.",
        sourceEventIds: [crypto.randomUUID()],
        detectedAt: new Date(),
      });

      const signals = await listSecuritySignalsForTarget(target.id);
      expect(signals).toHaveLength(1);
      expect(signals[0]?.signalType).toBe("__test__new-deployment");
      expect(signals[0]?.sourceEventIds).toHaveLength(1);
    });

    it("rejects a weight value outside 0..1 at the database level", async () => {
      const target = await createSecurityTarget({
        slug: "signal-invalid-protocol",
        name: "Signal Invalid",
      });

      await expect(
        persistSecuritySignal({
          securityTargetId: target.id,
          signalType: "__test__bad-weight",
          weight: -0.1,
          reasoning: "Invalid.",
          sourceEventIds: [crypto.randomUUID()],
          detectedAt: new Date(),
        }),
      ).rejects.toThrow();
    });
  });

  describe("security_opportunity", () => {
    it("creates a Security Opportunity scoped to its Security Target and opportunity type", async () => {
      const target = await createSecurityTarget({
        slug: "opportunity-protocol",
        name: "Opportunity Protocol",
      });

      const opportunity = await createSecurityOpportunity({
        securityTargetId: target.id,
        opportunityType: AUDIT_CONTEST,
        detectionWindow: "2026-W02",
        reasoning: "An audit contest was announced for this protocol.",
        detectedAt: new Date(),
      });

      expect(opportunity.status).toBe("detected");
      expect(await getSecurityOpportunity(opportunity.id)).toMatchObject({
        securityTargetId: target.id,
        opportunityType: AUDIT_CONTEST,
      });
    });

    it("is idempotent by (securityTargetId, opportunityType, detectionWindow): replaying produces the same row, not a duplicate", async () => {
      const target = await createSecurityTarget({
        slug: "opportunity-replay-protocol",
        name: "Replay Protocol",
      });
      const input = {
        securityTargetId: target.id,
        opportunityType: AUDIT_CONTEST,
        detectionWindow: "2026-W05",
        reasoning: "First reasoning.",
        detectedAt: new Date(),
      };

      const first = await createSecurityOpportunity(input);
      const second = await createSecurityOpportunity({ ...input, reasoning: "Second reasoning." });

      expect(second.id).toBe(first.id);
      expect(second.reasoning).toBe("First reasoning.");

      const rows = await getDb()
        .select()
        .from(schema.securityOpportunity)
        .where(eq(schema.securityOpportunity.securityTargetId, target.id));
      expect(rows).toHaveLength(1);
    });

    it("rejects a score value outside 0..1 at the database level", async () => {
      const target = await createSecurityTarget({
        slug: "opportunity-invalid-protocol",
        name: "Invalid Protocol",
      });

      await expect(
        getDb().insert(schema.securityOpportunity).values({
          id: crypto.randomUUID(),
          securityTargetId: target.id,
          opportunityType: AUDIT_CONTEST,
          detectionWindow: "2026-W06",
          reasoning: "Invalid.",
          detectedAt: new Date(),
          score: 2,
        }),
      ).rejects.toThrow();
    });
  });

  describe("audit_contest", () => {
    it("persists a contest linked to a Security Target and reads it back", async () => {
      const target = await createSecurityTarget({
        slug: "contest-protocol",
        name: "Contest Protocol",
      });

      const contest = await createAuditContest({
        securityTargetId: target.id,
        platform: "code4rena",
        title: "Contest Protocol Audit",
        startsAt: new Date("2026-02-01T00:00:00Z"),
        endsAt: new Date("2026-02-14T00:00:00Z"),
        rewardAmount: "$50,000",
      });

      expect(contest.status).toBe("upcoming");
      expect(await getAuditContestById(contest.id)).toMatchObject({
        platform: "code4rena",
        securityTargetId: target.id,
      });
    });

    it("allows a contest with no resolved Security Target yet", async () => {
      const contest = await createAuditContest({
        platform: "sherlock",
        title: "Unresolved Contest",
      });
      expect(contest.securityTargetId).toBeNull();
    });
  });

  describe("bug_bounty", () => {
    it("persists a bounty linked to a Security Target and reads it back", async () => {
      const target = await createSecurityTarget({
        slug: "bounty-protocol",
        name: "Bounty Protocol",
      });

      const bounty = await createBugBounty({
        securityTargetId: target.id,
        platform: "immunefi",
        maxRewardAmount: "$1,000,000",
        scopeUrl: "https://immunefi.com/bounty/bounty-protocol",
      });

      expect(bounty.status).toBe("active");
      expect(await getBugBountyById(bounty.id)).toMatchObject({
        platform: "immunefi",
        securityTargetId: target.id,
      });
    });

    it("allows a bounty with no resolved Security Target yet", async () => {
      const bounty = await createBugBounty({ platform: "hackenproof" });
      expect(bounty.securityTargetId).toBeNull();
    });
  });
});
