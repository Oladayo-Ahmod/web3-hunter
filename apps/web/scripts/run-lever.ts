import { runLeverCollector } from "../lib/collectors/run-lever";
import { getTrackedCompaniesForCollector } from "../lib/collectors/tracked-companies-from-directory";

/**
 * The "simplest viable" trigger for the Lever Collector, per the same
 * on-a-schedule pattern `collect:greenhouse` uses (docs/ROADMAP.md
 * Milestone 2). Collector logic has existed since Milestone 9 but was
 * never wired to any tracked company until Milestone 11's curated
 * directory gave it one. Tracked companies come from the directory, via
 * `company_source_identity` — never a hardcoded array.
 *
 *   pnpm --filter @web3-hunter/web exec tsx scripts/run-lever.ts
 */
async function main() {
  const tracked = await getTrackedCompaniesForCollector("lever");
  const results = await runLeverCollector(
    tracked.map(({ sourceIdentifier, ...rest }) => ({ ...rest, site: sourceIdentifier })),
  );

  for (const result of results) {
    if (result.status === "error") {
      console.error(`[lever] ${result.companySlug}: FAILED — ${result.message}`);
      continue;
    }

    console.log(
      `[lever] ${result.companySlug}: fetched ${result.fetched}, published ${result.published}, ` +
        `closed ${result.closed}, skipped ${result.skipped}`,
    );
  }

  const successCount = results.filter((result) => result.status !== "error").length;
  const errorCount = results.length - successCount;

  if (errorCount > 0) {
    console.error(`[lever] ${errorCount}/${results.length} companies failed this run.`);
  }

  // Fail the process (and therefore the GitHub Actions job) only when the
  // run made zero forward progress at all — a handful of permanently-dead
  // company boards must not make an otherwise-successful run look like a
  // total outage. Mirrors the identical partial-vs-total-failure
  // distinction `run-collector.ts`'s `recordRunHealth` already applies at
  // the Collector Health level.
  if (results.length > 0 && successCount === 0) {
    process.exitCode = 1;
  }
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((error: unknown) => {
    console.error("[lever] Fatal error running the collector:", error);
    process.exit(1);
  });
