import { runGreenhouseCollector } from "../lib/collectors/run-greenhouse";
import { getTrackedCompaniesForCollector } from "../lib/collectors/tracked-companies-from-directory";

/**
 * The "simplest viable" trigger for the Greenhouse Collector, per
 * docs/ROADMAP.md Milestone 2: run this on a schedule (a cron-triggered
 * CI workflow, to start) rather than standing up dedicated queue/worker
 * infrastructure this milestone doesn't need yet. Tracked companies come
 * from the curated directory (Milestone 11), via `company_source_identity`
 * — never a hardcoded array.
 *
 *   pnpm --filter @web3-hunter/web exec tsx scripts/run-greenhouse.ts
 */
async function main() {
  const tracked = await getTrackedCompaniesForCollector("greenhouse");
  const results = await runGreenhouseCollector(
    tracked.map(({ sourceIdentifier, ...rest }) => ({ ...rest, boardToken: sourceIdentifier })),
  );

  for (const result of results) {
    if (result.status === "error") {
      console.error(`[greenhouse] ${result.companySlug}: FAILED — ${result.message}`);
      continue;
    }

    console.log(
      `[greenhouse] ${result.companySlug}: fetched ${result.fetched}, published ${result.published}, ` +
        `closed ${result.closed}, skipped ${result.skipped}`,
    );
  }

  if (results.some((result) => result.status === "error")) {
    process.exitCode = 1;
  }
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((error: unknown) => {
    console.error("[greenhouse] Fatal error running the collector:", error);
    process.exit(1);
  });
