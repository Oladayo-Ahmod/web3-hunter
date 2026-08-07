import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getDb, upsertCompanyDirectory } from "@web3-hunter/db";
import { parseCompanyDirectory } from "./lib/company-directory";

// `apps/web` is an ES module package ("type": "module") - `__dirname`
// doesn't exist there, unlike in a CommonJS script.
const DIRECTORY_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "companies");

/**
 * Idempotently loads the curated company directory (one JSON file per
 * company, under apps/web/data/companies/) into `company` and
 * `company_source_identity` — Milestone 11's replacement for the static
 * tracked-company arrays. Safe to run repeatedly: re-running against
 * unchanged data is a no-op beyond re-applying the same profile fields.
 *
 *   pnpm --filter @web3-hunter/web exec tsx scripts/seed-companies.ts
 */
async function main() {
  const entries = parseCompanyDirectory(DIRECTORY_PATH);
  const results = await upsertCompanyDirectory(getDb(), entries);

  for (const result of results) {
    console.log(`[seed-companies] ${result.companySlug}: ${result.companyId}`);
  }

  console.log(
    `[seed-companies] ${results.length} compan${results.length === 1 ? "y" : "ies"} seeded.`,
  );
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((error: unknown) => {
    console.error("[seed-companies] Fatal error seeding the company directory:", error);
    process.exit(1);
  });
