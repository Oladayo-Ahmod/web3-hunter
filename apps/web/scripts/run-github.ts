import { TRACKED_GITHUB_ORGS } from "../lib/collectors/tracked-github-orgs";
import { runGithubCollector } from "../lib/collectors/run-github";

/**
 * The "simplest viable" trigger for the GitHub Collector, per the same
 * on-a-schedule pattern `collect:greenhouse` uses (docs/ROADMAP.md
 * Milestones 2 and 9).
 *
 *   pnpm --filter @web3-hunter/web exec tsx scripts/run-github.ts
 */
async function main() {
  const results = await runGithubCollector(TRACKED_GITHUB_ORGS);

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

main().catch((error: unknown) => {
  console.error("[github] Fatal error running the collector:", error);
  process.exitCode = 1;
});
