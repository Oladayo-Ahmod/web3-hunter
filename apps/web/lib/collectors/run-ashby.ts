import { ashby } from "@web3-hunter/collectors";
import { runCollector, type CollectorSourceConfig, type TrackedCompany } from "./run-collector";

const ASHBY_CONFIG: CollectorSourceConfig<ashby.AshbyJob> = {
  slug: "ashby",
  sourceType: "ats",
  fetchRecords: (boardName) => ashby.fetchAshbyJobs(boardName),
  externalIdOf: (job) => job.id,
  createNormalizer: ashby.createAshbyJobNormalizer,
  createClosedNormalizer: ashby.createAshbyJobClosedNormalizer,
};

export interface AshbyTrackedCompany extends Omit<TrackedCompany, "sourceIdentifier"> {
  /** The company's Ashby job board name, e.g. the `acme` in `jobs.ashbyhq.com/acme`. */
  boardName: string;
}

/**
 * The Ashby Collector, expressed as `CollectorSourceConfig` fed into the
 * shared `runCollector` orchestrator — see `./run-collector.ts` for
 * everything source-independent.
 */
export function runAshbyCollector(companies: readonly AshbyTrackedCompany[]) {
  return runCollector(
    ASHBY_CONFIG,
    companies.map(({ boardName, ...rest }) => ({ ...rest, sourceIdentifier: boardName })),
  );
}
