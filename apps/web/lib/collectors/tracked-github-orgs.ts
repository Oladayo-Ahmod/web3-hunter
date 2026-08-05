import type { TrackedGithubOrg } from "./run-github";

/**
 * The Milestone 9 seed list — a handful of real Web3/crypto companies'
 * public GitHub organizations, the same "intentionally just
 * configuration for now" spirit as `./tracked-companies.ts`'s Milestone 2
 * equivalent (see docs/DATABASE.md §9). `companySlug` intentionally
 * matches `./tracked-companies.ts`'s entries where the same company is
 * already tracked via Greenhouse — resolving through
 * `company_source_identity` to the identical Company row, per Milestone
 * 9's Definition of Ready.
 */
export const TRACKED_GITHUB_ORGS: readonly TrackedGithubOrg[] = [
  { companySlug: "consensys", companyName: "ConsenSys", org: "ConsenSys" },
  { companySlug: "coinbase", companyName: "Coinbase", org: "coinbase" },
  { companySlug: "paradigm", companyName: "Paradigm", org: "paradigmxyz" },
];
