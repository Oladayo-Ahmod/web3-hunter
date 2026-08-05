import { greenhouse } from "@web3-hunter/collectors";
import { runCollector, type CollectorSourceConfig, type TrackedCompany } from "./run-collector";

const GREENHOUSE_CONFIG: CollectorSourceConfig<greenhouse.GreenhouseJob> = {
  slug: "greenhouse",
  sourceType: "ats",
  fetchRecords: (boardToken) => greenhouse.fetchGreenhouseJobs(boardToken),
  externalIdOf: (job) => String(job.id),
  createNormalizer: greenhouse.createGreenhouseJobNormalizer,
  createClosedNormalizer: greenhouse.createGreenhouseJobClosedNormalizer,
};

export interface GreenhouseTrackedCompany extends Omit<TrackedCompany, "sourceIdentifier"> {
  /** The company's Greenhouse Job Board token, e.g. the `acme` in `boards.greenhouse.io/acme`. */
  boardToken: string;
}

/**
 * The Greenhouse Collector, expressed as `CollectorSourceConfig` fed into
 * the shared `runCollector` orchestrator — see `./run-collector.ts` for
 * everything source-independent.
 */
export function runGreenhouseCollector(companies: readonly GreenhouseTrackedCompany[]) {
  return runCollector(
    GREENHOUSE_CONFIG,
    companies.map(({ boardToken, ...rest }) => ({ ...rest, sourceIdentifier: boardToken })),
  );
}
