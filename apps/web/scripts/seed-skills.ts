import { getDb, seedSkillTaxonomy } from "@web3-hunter/db";

/**
 * Idempotently loads the initial Skill taxonomy (docs/ROADMAP.md
 * Milestone 5). Safe to run repeatedly.
 *
 *   pnpm --filter @web3-hunter/web exec tsx scripts/seed-skills.ts
 */
async function main() {
  await seedSkillTaxonomy(getDb());
  console.log("[seed-skills] Skill taxonomy seeded.");
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((error: unknown) => {
    console.error("[seed-skills] Fatal error seeding the Skill taxonomy:", error);
    process.exit(1);
  });
