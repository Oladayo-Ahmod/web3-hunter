import { getDb, schema } from "@web3-hunter/db";
import { createTestDatabase, type TestDatabase } from "@web3-hunter/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedSkill, seedUser, seedUserSkill } from "./test-support/seed";
import { getUserProfileSummary } from "./user-profile-query-service";

describe("getUserProfileSummary", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    process.env.DATABASE_URL = testDb.connectionString;
  }, 60_000);

  afterAll(async () => {
    await testDb.stop();
  });

  it("returns null for a User with no Profile yet", async () => {
    expect(await getUserProfileSummary(crypto.randomUUID())).toBeNull();
  });

  it("returns declared Skills and deal-breaker Skills, resolved to name/slug", async () => {
    const userId = await seedUser("profile-summary-user");
    const solidity = await seedSkill("profile-summary-solidity", "Solidity");
    const rust = await seedSkill("profile-summary-rust", "Rust");

    await getDb()
      .insert(schema.userProfile)
      .values({ userId, dealBreakerSkillIds: [rust.id] });
    await seedUserSkill(userId, solidity.id);

    const summary = await getUserProfileSummary(userId);

    expect(summary?.skills).toEqual([{ id: solidity.id, slug: solidity.slug, name: "Solidity" }]);
    expect(summary?.dealBreakerSkills).toEqual([{ id: rust.id, slug: rust.slug, name: "Rust" }]);
  });

  it("returns empty lists for a Profile with no Skills or deal-breakers set", async () => {
    const userId = await seedUser("empty-profile-user");
    await getDb().insert(schema.userProfile).values({ userId });

    const summary = await getUserProfileSummary(userId);

    expect(summary?.skills).toEqual([]);
    expect(summary?.dealBreakerSkills).toEqual([]);
  });
});
