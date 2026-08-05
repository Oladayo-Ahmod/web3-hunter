import { getDb, schema } from "@web3-hunter/db";
import { createTestDatabase, type TestDatabase } from "@web3-hunter/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { evaluateMatch } from "./match-store";
import { runMatchingPipeline } from "./run-matching-pipeline";
import {
  ensureUserProfile,
  getUserProfile,
  setDealBreakerSkills,
  setUserSkills,
} from "./user-profile-store";

async function seedUser(label: string) {
  const db = getDb();
  // A real UUID, matching what Better Auth actually generates in
  // apps/web/lib/auth.ts (advanced.database.generateId) — MatchComputed's
  // relatedEntityId requires it.
  const id = crypto.randomUUID();
  await db.insert(schema.user).values({ id, name: label, email: `${label}@example.test` });
  return id;
}

async function seedSkill(slug: string) {
  const db = getDb();
  const [row] = await db.insert(schema.skill).values({ slug, name: slug }).returning();
  return row!;
}

async function seedCompanyAndOpportunity(slug: string, status: "detected" | "scored" = "scored") {
  const db = getDb();
  const [company] = await db.insert(schema.company).values({ slug, name: slug }).returning();
  const [opportunity] = await db
    .insert(schema.opportunity)
    .values({
      id: crypto.randomUUID(),
      companyId: company!.id,
      opportunityType: "engineering-hiring-surge",
      detectionWindow: "2026-W01",
      status,
      score: status === "scored" ? 0.7 : null,
      reasoning: "test",
      detectedAt: new Date("2026-01-01T00:00:00Z"),
      scoredAt: status === "scored" ? new Date("2026-01-01T00:00:00Z") : null,
    })
    .returning();
  return opportunity!.id;
}

/**
 * A direct fixture, not a call through `packages/classification`'s real
 * `persistOpportunitySkill` (packages/matching never depends on
 * packages/classification). Still inserts a matching `event` row first —
 * `opportunity_skill.id` is always a real Event's ID in production (the
 * same relationship `signal.id` has to `HiringSignalDetected`), and
 * `evaluateMatch` cites it as `MatchComputed`'s provenance, which requires
 * the row to actually exist.
 */
async function tagOpportunitySkill(opportunityId: string, skillId: string) {
  const db = getDb();
  const id = crypto.randomUUID();

  await db.insert(schema.event).values({
    id,
    type: "OpportunitySkillDetected",
    category: "intelligence",
    version: 1,
    sourceLabel: "test-fixture",
    occurredAt: new Date("2026-01-01T00:00:00Z"),
    confidence: 0.6,
    metadata: {},
  });

  await db.insert(schema.opportunitySkill).values({
    id,
    opportunityId,
    skillId,
    confidence: 0.6,
    reasoning: "test",
    sourceEventIds: [crypto.randomUUID()],
    detectedAt: new Date("2026-01-01T00:00:00Z"),
  });
}

describe("packages/matching (integration)", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    process.env.DATABASE_URL = testDb.connectionString;
  }, 60_000);

  afterAll(async () => {
    await testDb.stop();
  });

  describe("user-profile-store", () => {
    it("creates a minimal profile and lets Skills/deal-breakers be set", async () => {
      const userId = await seedUser("profile-user");
      const solidity = await seedSkill("profile-solidity");
      const rust = await seedSkill("profile-rust");

      await ensureUserProfile(userId);
      await setUserSkills(userId, [solidity.id, rust.id]);
      await setDealBreakerSkills(userId, [rust.id]);

      const profile = await getUserProfile(userId);
      expect([...(profile?.skillIds ?? [])].sort()).toEqual([solidity.id, rust.id].sort());
      expect(profile?.dealBreakerSkillIds).toEqual([rust.id]);
    });

    it("setUserSkills fully replaces the previous Skill set", async () => {
      const userId = await seedUser("replace-user");
      const a = await seedSkill("replace-a");
      const b = await seedSkill("replace-b");

      await setUserSkills(userId, [a.id]);
      await setUserSkills(userId, [b.id]);

      const profile = await getUserProfile(userId);
      expect(profile?.skillIds).toEqual([b.id]);
    });

    it("returns null for a User with no profile yet", async () => {
      expect(await getUserProfile(crypto.randomUUID())).toBeNull();
    });
  });

  describe("evaluateMatch", () => {
    it("returns null when the User has no Profile", async () => {
      const opportunityId = await seedCompanyAndOpportunity("no-profile-co");
      const result = await evaluateMatch(crypto.randomUUID(), opportunityId, new Date());
      expect(result).toBeNull();
    });

    it("returns null when the Opportunity is not yet scored", async () => {
      const userId = await seedUser("unscored-user");
      await ensureUserProfile(userId);
      const opportunityId = await seedCompanyAndOpportunity("unscored-co", "detected");

      expect(await evaluateMatch(userId, opportunityId, new Date())).toBeNull();
    });

    it("returns null when the Opportunity has no tagged Skills yet", async () => {
      const userId = await seedUser("no-skills-user");
      await ensureUserProfile(userId);
      const opportunityId = await seedCompanyAndOpportunity("no-skills-co");

      expect(await evaluateMatch(userId, opportunityId, new Date())).toBeNull();
    });

    it("returns null when a deal-breaker Skill is present, even with other overlap", async () => {
      const userId = await seedUser("dealbreaker-user");
      const solidity = await seedSkill("dealbreaker-solidity");
      const rust = await seedSkill("dealbreaker-rust");
      await setUserSkills(userId, [solidity.id, rust.id]);
      await setDealBreakerSkills(userId, [rust.id]);

      const opportunityId = await seedCompanyAndOpportunity("dealbreaker-co");
      await tagOpportunitySkill(opportunityId, solidity.id);
      await tagOpportunitySkill(opportunityId, rust.id);

      expect(await evaluateMatch(userId, opportunityId, new Date())).toBeNull();

      const rows = await getDb().select().from(schema.match);
      expect(rows.some((row) => row.userId === userId)).toBe(false);
    });

    it("computes and persists a Match citing the matched Skills", async () => {
      const userId = await seedUser("match-user");
      const solidity = await seedSkill("match-solidity");
      const rust = await seedSkill("match-rust");
      await setUserSkills(userId, [solidity.id]);

      const opportunityId = await seedCompanyAndOpportunity("match-co");
      await tagOpportunitySkill(opportunityId, solidity.id);
      await tagOpportunitySkill(opportunityId, rust.id);

      const result = await evaluateMatch(userId, opportunityId, new Date("2026-02-01T00:00:00Z"));
      expect(result?.computed).toBe(true);

      const [row] = await getDb()
        .select()
        .from(schema.match)
        .where(eq(schema.match.id, result!.matchId));
      expect(row?.score).toBe(0.5);
      expect(row?.matchedSkillIds).toEqual([solidity.id]);
      expect(row?.userId).toBe(userId);
      expect(row?.opportunityId).toBe(opportunityId);
    });

    it("is idempotent: re-evaluating an unchanged Match reports computed: false", async () => {
      const userId = await seedUser("idempotent-match-user");
      const solidity = await seedSkill("idempotent-solidity");
      await setUserSkills(userId, [solidity.id]);

      const opportunityId = await seedCompanyAndOpportunity("idempotent-match-co");
      await tagOpportunitySkill(opportunityId, solidity.id);

      const first = await evaluateMatch(userId, opportunityId, new Date());
      const second = await evaluateMatch(userId, opportunityId, new Date());

      expect(first?.computed).toBe(true);
      expect(second?.computed).toBe(false);
      expect(second?.matchId).toBe(first?.matchId);
    });

    it("is deterministic: recomputing from the same inputs twice produces the same score and reasoning", async () => {
      const userId = await seedUser("determinism-user");
      const solidity = await seedSkill("determinism-solidity");
      const rust = await seedSkill("determinism-rust");
      await setUserSkills(userId, [solidity.id]);

      const opportunityId = await seedCompanyAndOpportunity("determinism-co");
      await tagOpportunitySkill(opportunityId, solidity.id);
      await tagOpportunitySkill(opportunityId, rust.id);

      const matchId = (await evaluateMatch(userId, opportunityId, new Date()))!.matchId;
      const [before] = await getDb()
        .select()
        .from(schema.match)
        .where(eq(schema.match.id, matchId));

      // Force a "changed" recomputation by touching the User's Skills and
      // reverting them, to prove the score/reasoning it lands back on are
      // identical to the original — not just that a no-op skip occurred.
      await setUserSkills(userId, []);
      await evaluateMatch(userId, opportunityId, new Date());
      await setUserSkills(userId, [solidity.id]);
      await evaluateMatch(userId, opportunityId, new Date());

      const [after] = await getDb().select().from(schema.match).where(eq(schema.match.id, matchId));
      expect(after?.score).toBe(before?.score);
      expect(after?.reasoning).toBe(before?.reasoning);
      expect(after?.matchedSkillIds).toEqual(before?.matchedSkillIds);
    });

    it("blends in Technology fit when the Opportunity's Company has a Technology Profile (Milestone 9)", async () => {
      const userId = await seedUser("technology-fit-user");
      const solidity = await seedSkill("technology-fit-solidity");
      const rust = await seedSkill("technology-fit-rust");
      await setUserSkills(userId, [solidity.id, rust.id]);

      const db = getDb();
      const [company] = await db
        .insert(schema.company)
        .values({ slug: "technology-fit-co", name: "technology-fit-co" })
        .returning();
      const [opportunity] = await db
        .insert(schema.opportunity)
        .values({
          id: crypto.randomUUID(),
          companyId: company!.id,
          opportunityType: "engineering-hiring-surge",
          detectionWindow: "2026-W01",
          status: "scored",
          score: 0.7,
          reasoning: "test",
          detectedAt: new Date("2026-01-01T00:00:00Z"),
          scoredAt: new Date("2026-01-01T00:00:00Z"),
        })
        .returning();
      await tagOpportunitySkill(opportunity!.id, solidity.id);

      await db.insert(schema.companyTechnologyProfile).values({
        companyId: company!.id,
        skillIds: [rust.id],
        evidenceCount: 1,
        asOf: new Date("2026-01-01T00:00:00Z"),
      });

      const result = await evaluateMatch(userId, opportunity!.id, new Date("2026-02-01T00:00:00Z"));
      expect(result?.computed).toBe(true);

      const [row] = await getDb()
        .select()
        .from(schema.match)
        .where(eq(schema.match.id, result!.matchId));
      // Skill fit 1/1 * 0.7 + Technology fit 1/1 * 0.3 = 1.0
      expect(row?.score).toBe(1);
      expect(row?.matchedSkillIds).toEqual([solidity.id]);
      expect(row?.matchedTechnologySkillIds).toEqual([rust.id]);
      expect(row?.reasoning).toContain("GitHub");
    });
  });

  describe("runMatchingPipeline", () => {
    it("computes Matches across every scored Opportunity for a User", async () => {
      const userId = await seedUser("pipeline-user");
      const solidity = await seedSkill("pipeline-solidity");
      await setUserSkills(userId, [solidity.id]);

      const opportunityA = await seedCompanyAndOpportunity("pipeline-co-a");
      await tagOpportunitySkill(opportunityA, solidity.id);
      const opportunityB = await seedCompanyAndOpportunity("pipeline-co-b");
      await tagOpportunitySkill(opportunityB, solidity.id);
      const unscoredOpportunity = await seedCompanyAndOpportunity(
        "pipeline-co-unscored",
        "detected",
      );

      const result = await runMatchingPipeline(userId);

      // The shared test database also holds scored, Skill-tagged
      // Opportunities from other tests in this file, which this User
      // (having no deal-breakers) legitimately gets zero-overlap Matches
      // against too — so this asserts the two Matches this test cares
      // about exist with the right score, not an exact system-wide count.
      expect(result.opportunitiesConsidered).toBeGreaterThanOrEqual(2);
      expect(result.matchesComputed).toBeGreaterThanOrEqual(2);

      const rows = await getDb().select().from(schema.match).where(eq(schema.match.userId, userId));
      const rowsByOpportunity = new Map(rows.map((row) => [row.opportunityId, row]));
      expect(rowsByOpportunity.get(opportunityA)?.score).toBe(1);
      expect(rowsByOpportunity.get(opportunityB)?.score).toBe(1);
      expect(rowsByOpportunity.has(unscoredOpportunity)).toBe(false);
    });
  });
});
