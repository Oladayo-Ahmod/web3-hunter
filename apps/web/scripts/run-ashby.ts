import { runAshbyCollector } from "../lib/collectors/run-ashby";
import { getTrackedCompaniesForCollector } from "../lib/collectors/tracked-companies-from-directory";

/**
 * The "simplest viable" trigger for the Ashby Collector, per the same
 * on-a-schedule pattern `collect:greenhouse` uses (docs/ROADMAP.md
 * Milestone 2). Collector logic has existed since Milestone 9 but was
 * never wired to any tracked company until Milestone 11's curated
 * directory gave it one. Tracked companies come from the directory, via
 * `company_source_identity` — never a hardcoded array.
 *
 *   pnpm --filter @web3-hunter/web exec tsx scripts/run-ashby.ts
 */
async function main() {
  const tracked = await getTrackedCompaniesForCollector("ashby");
  const results = await runAshbyCollector(
    tracked.map(({ sourceIdentifier, ...rest }) => ({ ...rest, boardName: sourceIdentifier })),
  );

  for (const result of results) {
    if (result.status === "error") {
      console.error(`[ashby] ${result.companySlug}: FAILED — ${result.message}`);
      continue;
    }

    console.log(
      `[ashby] ${result.companySlug}: fetched ${result.fetched}, published ${result.published}, ` +
        `closed ${result.closed}, skipped ${result.skipped}`,
    );
  }

  const successCount = results.filter((result) => result.status !== "error").length;
  const errorCount = results.length - successCount;

  if (errorCount > 0) {
    console.error(`[ashby] ${errorCount}/${results.length} companies failed this run.`);
  }

  // See run-lever.ts's identical comment: fail only on zero successes.
  if (results.length > 0 && successCount === 0) {
    process.exitCode = 1;
  }
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((error: unknown) => {
    console.error("[ashby] Fatal error running the collector:", error);
    process.exit(1);
  });
