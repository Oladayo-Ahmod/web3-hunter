import type { TrackedCompany } from "./run-greenhouse";

/**
 * The Milestone 2 seed list — a handful of real Web3/crypto companies
 * confirmed to run a public Greenhouse board, per docs/ROADMAP.md
 * Milestone 2 ("a seeded list of tracked companies"). A real watchlist
 * feature is a future enhancement (see docs/DATABASE.md §9); this is
 * intentionally just configuration for now.
 */
export const TRACKED_GREENHOUSE_COMPANIES: readonly TrackedCompany[] = [
  { slug: "consensys", name: "ConsenSys", boardToken: "consensys" },
  { slug: "coinbase", name: "Coinbase", boardToken: "coinbase" },
  { slug: "paradigm", name: "Paradigm", boardToken: "paradigm" },
];
