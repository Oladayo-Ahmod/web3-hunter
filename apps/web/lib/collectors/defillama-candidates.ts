import { COMMON_ENGLISH_WORDS } from "./common-english-words";
import type { DiscoveryCandidate } from "./discover-companies";

/**
 * Milestone 15 §H/§I — the permanent, tested replacement for the
 * throwaway batch-1 prep script. Turns DeFiLlama's raw `/protocols`
 * response into a ranked, deduplicated `DiscoveryCandidate[]` for the
 * existing, unmodified discovery pipeline (`discoverCompanies` in
 * `discover-companies.ts`). No network calls in this module — callers
 * fetch the raw protocol list and pass it in, which is what makes every
 * function here a pure, unit-testable function of real data.
 */

export interface DefiLlamaProtocol {
  name: string;
  slug: string;
  url?: string | null;
  category?: string | null;
  tvl?: number | null;
  parentProtocol?: string | null;
}

interface ProtocolGroup {
  rootSlug: string;
  name: string;
  totalTvl: number;
  categories: readonly string[];
  url: string | null;
}

/**
 * Collapses version/fork variants of the same real entity (Aave
 * V1/V2/V3/..., all under `parentProtocol: "parent#aave"`) into one
 * candidate per root, exactly as batch 1 did. The chosen display name
 * prefers a real, correctly-branded standalone entry when one exists
 * (e.g. "Lido", "OKX") over humanizing the root slug, which is only a
 * fallback for groups where every member is a sub-entry (e.g.
 * "ondo-finance" -> "Ondo Finance", since no bare "Ondo Finance" entry
 * exists in the raw data).
 */
export function dedupeProtocols(
  protocols: readonly DefiLlamaProtocol[],
): ReadonlyMap<string, ProtocolGroup> {
  const groups = new Map<string, { members: DefiLlamaProtocol[]; totalTvl: number }>();

  for (const protocol of protocols) {
    const rootSlug = protocol.parentProtocol
      ? protocol.parentProtocol.split("#")[1]
      : protocol.slug;
    if (!rootSlug) continue;
    const group = groups.get(rootSlug) ?? { members: [], totalTvl: 0 };
    group.members.push(protocol);
    group.totalTvl += typeof protocol.tvl === "number" ? protocol.tvl : 0;
    groups.set(rootSlug, group);
  }

  const result = new Map<string, ProtocolGroup>();
  for (const [rootSlug, group] of groups) {
    const categories = [
      ...new Set(group.members.map((m) => m.category).filter((c): c is string => Boolean(c))),
    ];
    const ownEntry = group.members.find((m) => m.slug === rootSlug && !m.parentProtocol);
    const name = ownEntry ? ownEntry.name : humanizeSlug(rootSlug);
    const url = group.members.find((m) => m.url)?.url ?? null;
    result.set(rootSlug, { rootSlug, name, totalTvl: group.totalTvl, categories, url });
  }
  return result;
}

export function humanizeSlug(slug: string): string {
  return slug
    .split("-")
    .map((word) => (word.length === 0 ? word : word.charAt(0).toUpperCase() + word.slice(1)))
    .join(" ");
}

/**
 * Categories judged structurally closer to this product's target roles
 * (security/protocol/backend engineering) — unchanged from batch 1.
 * Not a hard filter anywhere in this module: Tier 2 candidates are
 * ranked, not discarded.
 */
export const TIER1_CATEGORIES: ReadonlySet<string> = new Set([
  "Security Extension",
  "Developer Tools",
  "Lending",
  "RWA Lending",
  "Dexs",
  "DEX Aggregator",
  "Bridge",
  "Cross Chain Bridge",
  "Bridge Aggregator",
  "Bridge Aggregators",
  "Oracle",
  "Wallets",
  "RWA",
  "Restaking",
  "Liquid Restaking",
  "Restaked BTC",
  "CDP",
  "CDP Manager",
  "Liquid Staking",
  "Staking Pool",
  "Staking Rental",
  "Chain",
  "MEV",
  "Block Builders",
  "Privacy",
  "Identity & Reputation",
]);

export function isTier1(group: Pick<ProtocolGroup, "categories">): boolean {
  return group.categories.some((c) => TIER1_CATEGORIES.has(c));
}

/**
 * Milestone 15 §I.2 — evaluated against the 26 known-good and 22
 * known-bad candidates from the first DeFiLlama batch
 * (`defillama-candidates.test.ts` `describe("distinctivenessPenalty
 * evaluation")`) and found to give **weak, not meaningful, separation**:
 * it flagged only 4 of 21 known wrong-company/uncertain root names
 * (19% recall) and incorrectly flagged 1 of 25 known-genuine ones
 * ("gate" — Gate.io, a real exchange whose name is also a common
 * English word). Per the explicit instruction that produced this
 * module, a heuristic that doesn't show meaningful separation on real
 * historical data is not used, not rationalized into use — so this
 * function is **not called anywhere in `buildDiscoveryCandidates`**.
 * Kept as a tested, documented, available-but-unused capability rather
 * than deleted outright, so the evaluation is reproducible and the
 * finding doesn't have to be re-derived if revisited later with a
 * different design (e.g. a per-word rather than per-root check).
 */
export function distinctivenessPenalty(rootSlug: string): number {
  const bare = rootSlug.replace(/-/g, "");
  return COMMON_ENGLISH_WORDS.has(bare) ? 1 : 0;
}

interface RankedCandidate extends ProtocolGroup {
  tier: 1 | 2;
}

/**
 * Ranks all deduplicated groups exactly as batch 1 did: Tier 1 before
 * Tier 2, descending total TVL within each tier. `distinctivenessPenalty`
 * is deliberately not part of this — see its doc comment.
 */
export function rankCandidates(
  groups: ReadonlyMap<string, ProtocolGroup>,
): readonly RankedCandidate[] {
  const tier1: RankedCandidate[] = [];
  const tier2: RankedCandidate[] = [];
  for (const group of groups.values()) {
    (isTier1(group) ? tier1 : tier2).push({ ...group, tier: isTier1(group) ? 1 : 2 });
  }
  tier1.sort((a, b) => b.totalTvl - a.totalTvl);
  tier2.sort((a, b) => b.totalTvl - a.totalTvl);
  return [...tier1, ...tier2];
}

const SUFFIXES_TO_STRIP = [
  "network",
  "finance",
  "labs",
  "protocol",
  "foundation",
  "io",
  "eth",
  "xyz",
];

export function slugVariants(name: string, rootSlug: string): readonly string[] {
  const variants = new Set<string>();
  variants.add(rootSlug.replace(/-/g, ""));
  variants.add(rootSlug);

  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
  variants.add(base.replace(/-/g, ""));
  variants.add(base);

  for (const suffix of SUFFIXES_TO_STRIP) {
    if (rootSlug.endsWith(`-${suffix}`)) {
      variants.add(rootSlug.slice(0, -(suffix.length + 1)).replace(/-/g, ""));
    }
  }

  return [...variants].filter((v) => v.length > 0);
}

export interface BuildCandidatesOptions {
  /** How many ranked candidates to skip before selecting — lets a later batch start where the previous one's selection ended, instead of re-selecting the same top candidates (resumability at the probe layer already makes overlap harmless, but skipping keeps a batch's candidate *list* meaningfully "the next N", matching how batch 1 was described). */
  tier1Skip?: number;
  tier2Skip?: number;
  tier1Count?: number;
  tier2Count?: number;
}

/**
 * The full pipeline: dedupe -> rank -> select -> generate
 * `DiscoveryCandidate`s (name, slug variants, and — new in this module —
 * `domain`, carrying DeFiLlama's own `url` through so
 * `resolveDiscoveredCompany`'s domain-match tier can catch cross-source
 * duplicates like "Paxos" vs. the already-discovered "paxoslabs").
 */
export function buildDiscoveryCandidates(
  protocols: readonly DefiLlamaProtocol[],
  options: BuildCandidatesOptions = {},
): DiscoveryCandidate[] {
  const { tier1Skip = 0, tier2Skip = 0, tier1Count = 450, tier2Count = 50 } = options;
  const groups = dedupeProtocols(protocols);
  const ranked = rankCandidates(groups);
  const tier1Ranked = ranked.filter((c) => c.tier === 1);
  const tier2Ranked = ranked.filter((c) => c.tier === 2);

  const selected = [
    ...tier1Ranked.slice(tier1Skip, tier1Skip + tier1Count),
    ...tier2Ranked.slice(tier2Skip, tier2Skip + tier2Count),
  ];

  return selected.map((candidate) => ({
    name: candidate.name,
    slugs: slugVariants(candidate.name, candidate.rootSlug),
    domain: candidate.url,
  }));
}
