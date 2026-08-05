import { lever } from "@web3-hunter/collectors";
import { runCollector, type CollectorSourceConfig, type TrackedCompany } from "./run-collector";

const LEVER_CONFIG: CollectorSourceConfig<lever.LeverPosting> = {
  slug: "lever",
  sourceType: "ats",
  fetchRecords: (site) => lever.fetchLeverPostings(site),
  externalIdOf: (posting) => posting.id,
  createNormalizer: lever.createLeverJobNormalizer,
  createClosedNormalizer: lever.createLeverJobClosedNormalizer,
};

export interface LeverTrackedCompany extends Omit<TrackedCompany, "sourceIdentifier"> {
  /** The company's Lever site slug, e.g. the `acme` in `jobs.lever.co/acme`. */
  site: string;
}

/**
 * The Lever Collector, expressed as `CollectorSourceConfig` fed into the
 * shared `runCollector` orchestrator — see `./run-collector.ts` for
 * everything source-independent.
 */
export function runLeverCollector(companies: readonly LeverTrackedCompany[]) {
  return runCollector(
    LEVER_CONFIG,
    companies.map(({ site, ...rest }) => ({ ...rest, sourceIdentifier: site })),
  );
}
