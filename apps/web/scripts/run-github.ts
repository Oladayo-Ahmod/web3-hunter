import { runGithubCollector } from "../lib/collectors/run-github";
import { getTrackedCompaniesForCollector } from "../lib/collectors/tracked-companies-from-directory";

/**
 * The "simplest viable" trigger for the GitHub Collector, per the same
 * on-a-schedule pattern `collect:greenhouse` uses (docs/ROADMAP.md
 * Milestones 2 and 9). Tracked orgs come from the curated directory
 * (Milestone 11), via `company_source_identity` — never a hardcoded
 * array.
 *
 *   pnpm --filter @web3-hunter/web exec tsx scripts/run-github.ts
 */
async function main() {
  const tracked = await getTrackedCompaniesForCollector("github");
  const results = await runGithubCollector(
    tracked.map(({ sourceIdentifier, ...rest }) => ({ ...rest, org: sourceIdentifier })),
  );

  for (const result of results) {
    if (result.status === "error") {
      console.error(`[github] ${result.companySlug}: FAILED — ${result.message}`);
      continue;
    }

    console.log(
      `[github] ${result.companySlug}: fetched ${result.fetched}, published ${result.published}, ` +
        `skipped ${result.skipped}`,
    );
  }

  if (results.some((result) => result.status === "error")) {
    process.exitCode = 1;
  }
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((error: unknown) => {
    console.error("[github] Fatal error running the collector:", error);
    process.exit(1);
  });
