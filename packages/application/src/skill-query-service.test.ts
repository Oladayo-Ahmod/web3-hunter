import { createTestDatabase, type TestDatabase } from "@web3-hunter/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listSkills } from "./skill-query-service";
import { seedSkill } from "./test-support/seed";

describe("listSkills", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    process.env.DATABASE_URL = testDb.connectionString;
  }, 60_000);

  afterAll(async () => {
    await testDb.stop();
  });

  it("returns every Skill in the taxonomy, alphabetically by name", async () => {
    await seedSkill("list-skills-zeta", "Zeta Skill");
    await seedSkill("list-skills-alpha", "Alpha Skill");

    const skills = await listSkills();
    const names = skills.map((s) => s.name);
    const alphaIndex = names.indexOf("Alpha Skill");
    const zetaIndex = names.indexOf("Zeta Skill");

    expect(alphaIndex).toBeGreaterThanOrEqual(0);
    expect(zetaIndex).toBeGreaterThan(alphaIndex);
  });
});
