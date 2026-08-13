import { describe, expect, it } from "vitest";
import {
  buildDiscoveryCandidates,
  dedupeProtocols,
  distinctivenessPenalty,
  humanizeSlug,
  isTier1,
  rankCandidates,
  slugVariants,
  type DefiLlamaProtocol,
} from "./defillama-candidates";

function protocol(overrides: Partial<DefiLlamaProtocol> = {}): DefiLlamaProtocol {
  return {
    name: "Test Protocol",
    slug: "test-protocol",
    url: null,
    category: "Lending",
    tvl: 0,
    parentProtocol: null,
    ...overrides,
  };
}

describe("dedupeProtocols", () => {
  it("collapses version/fork variants under the same parentProtocol into one candidate", () => {
    const groups = dedupeProtocols([
      protocol({ name: "Aave V3", slug: "aave-v3", parentProtocol: "parent#aave", tvl: 100 }),
      protocol({ name: "Aave V2", slug: "aave-v2", parentProtocol: "parent#aave", tvl: 50 }),
      protocol({ name: "Aave Labs", slug: "aave-labs", parentProtocol: null, tvl: 0 }),
    ]);

    // "Aave Labs" has no parentProtocol, so it's its own root - never
    // merged with the "parent#aave" group, the same conservative
    // behavior resolveDiscoveredCompany itself uses (exact match only).
    expect(groups.size).toBe(2);
    const aaveGroup = groups.get("aave")!;
    expect(aaveGroup.totalTvl).toBe(150);
    // No standalone "aave" entry exists in this fixture, so the name is
    // humanized from the root slug.
    expect(aaveGroup.name).toBe("Aave");
  });

  it("uses a real standalone entry's own name when one exists, not a humanized slug", () => {
    const groups = dedupeProtocols([
      protocol({ name: "OKX", slug: "okx", parentProtocol: null, tvl: 500 }),
    ]);
    expect(groups.get("okx")!.name).toBe("OKX");
  });

  it("carries the group's known url through for domain propagation", () => {
    const groups = dedupeProtocols([
      protocol({
        name: "Ondo Perps",
        slug: "ondo-perps",
        parentProtocol: "parent#ondo-finance",
        url: null,
      }),
      protocol({
        name: "Ondo Global Markets",
        slug: "ondo-global-markets",
        parentProtocol: "parent#ondo-finance",
        url: "https://ondo.finance",
      }),
    ]);
    expect(groups.get("ondo-finance")!.url).toBe("https://ondo.finance");
  });
});

describe("humanizeSlug", () => {
  it("title-cases a hyphenated slug", () => {
    expect(humanizeSlug("ondo-finance")).toBe("Ondo Finance");
    expect(humanizeSlug("okx")).toBe("Okx");
  });
});

describe("isTier1 / rankCandidates", () => {
  it("ranks Tier 1 (target-relevant category) candidates before Tier 2, TVL descending within each", () => {
    const groups = dedupeProtocols([
      protocol({ name: "Small Lending", slug: "small-lending", category: "Lending", tvl: 10 }),
      protocol({ name: "Big Lending", slug: "big-lending", category: "Lending", tvl: 1000 }),
      protocol({
        name: "Big NFT Marketplace",
        slug: "big-nft",
        category: "NFT Marketplace",
        tvl: 5000,
      }),
    ]);
    const ranked = rankCandidates(groups);
    expect(ranked.map((c) => c.rootSlug)).toEqual(["big-lending", "small-lending", "big-nft"]);
    expect(isTier1({ categories: ["Lending"] })).toBe(true);
    expect(isTier1({ categories: ["NFT Marketplace"] })).toBe(false);
  });
});

describe("slugVariants", () => {
  it("generates both hyphenated and concatenated forms, plus suffix-stripped variants", () => {
    const variants = slugVariants("Ondo Finance", "ondo-finance");
    expect(variants).toContain("ondofinance");
    expect(variants).toContain("ondo-finance");
    expect(variants).toContain("ondo"); // "finance" suffix stripped
  });
});

describe("buildDiscoveryCandidates", () => {
  it("propagates the group's url as the candidate's domain", () => {
    const candidates = buildDiscoveryCandidates(
      [
        protocol({
          name: "Ondo Finance",
          slug: "ondo-finance",
          url: "https://ondo.finance",
          category: "RWA",
          tvl: 100,
        }),
      ],
      { tier1Count: 10, tier2Count: 10 },
    );
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.domain).toBe("https://ondo.finance");
  });

  it("sets domain to null when DeFiLlama has none, never a guess", () => {
    const candidates = buildDiscoveryCandidates(
      [
        protocol({
          name: "No URL Protocol",
          slug: "no-url-protocol",
          url: null,
          category: "Lending",
        }),
      ],
      { tier1Count: 10, tier2Count: 10 },
    );
    expect(candidates[0]!.domain).toBeNull();
  });

  it("respects tier1Count/tier2Count without ever selecting more Tier 2 than Tier 1 relevance intends", () => {
    const protocols = Array.from({ length: 10 }, (_, i) =>
      protocol({ name: `Lending ${i}`, slug: `lending-${i}`, category: "Lending", tvl: 10 - i }),
    );
    const candidates = buildDiscoveryCandidates(protocols, { tier1Count: 3, tier2Count: 0 });
    expect(candidates).toHaveLength(3);
    expect(candidates.map((c) => c.name)).toEqual(["Lending 0", "Lending 1", "Lending 2"]);
  });

  it("skip lets a later batch select the next slice instead of re-selecting the same top candidates", () => {
    const protocols = Array.from({ length: 5 }, (_, i) =>
      protocol({ name: `Lending ${i}`, slug: `lending-${i}`, category: "Lending", tvl: 10 - i }),
    );
    const firstBatch = buildDiscoveryCandidates(protocols, { tier1Count: 2, tier2Count: 0 });
    const secondBatch = buildDiscoveryCandidates(protocols, {
      tier1Skip: 2,
      tier1Count: 2,
      tier2Count: 0,
    });
    expect(firstBatch.map((c) => c.name)).toEqual(["Lending 0", "Lending 1"]);
    expect(secondBatch.map((c) => c.name)).toEqual(["Lending 2", "Lending 3"]);
  });
});

/**
 * Milestone 15 §I.2 — the required empirical evaluation of
 * `distinctivenessPenalty` against the real, individually-verified
 * outcomes from the first DeFiLlama batch
 * (`docs/MILESTONE_15_JOB_DISCOVERY_EXPANSION_RESEARCH.md` §H.2). These
 * root slugs are the real candidates that were actually probed and
 * manually verified — not a synthetic fixture — because the whole point
 * is testing whether the heuristic would have helped on data we already
 * know the ground truth for.
 */
describe("distinctivenessPenalty evaluation against the real batch-1 outcomes", () => {
  // Confirmed wrong-company, duplicate, or unverifiable-and-rejected.
  const KNOWN_BAD_ROOT_SLUGS = [
    "current",
    "blend",
    "kodiak",
    "indigo",
    "unit",
    "sphere",
    "felix",
    "kinetic",
    "hive-protocol",
    "maya-protocol",
    "navi-protocol",
    "flux-finance",
    "linear-protocol",
    "reservoir-protocol",
    "solstice",
    "veda",
    "echo-protocol",
    "solera",
    "falcon-finance",
    "ethena",
    "paxos",
  ];

  // Confirmed genuinely correct, real, currently-open Web3 companies.
  const KNOWN_GOOD_ROOT_SLUGS = [
    "arbitrum-foundation",
    "superstate",
    "symbiotic",
    "wisdomtree",
    "polymarket",
    "doublezero",
    "grvt",
    "bitvavo",
    "ondo-finance",
    "securitize",
    "gauntlet",
    "swissborg",
    "lightning-network",
    "wan-bridge",
    "metadao",
    "ston.fi",
    "woofi",
    "orca",
    "jito",
    "gate",
    "okx",
    "robinhood",
    "gemini",
    "bitmex",
    "bybit",
  ];

  it("reports the actual separation, and confirms it is too weak to use", () => {
    const badFlagged = KNOWN_BAD_ROOT_SLUGS.filter((slug) => distinctivenessPenalty(slug) > 0);
    const goodFlagged = KNOWN_GOOD_ROOT_SLUGS.filter((slug) => distinctivenessPenalty(slug) > 0);

    const badRecall = badFlagged.length / KNOWN_BAD_ROOT_SLUGS.length;
    const goodFalsePositiveRate = goodFlagged.length / KNOWN_GOOD_ROOT_SLUGS.length;

    // The real, measured numbers (not asserted-then-tuned): 4/21 known-bad
    // candidates flagged (current, blend, unit, sphere), 1/25 known-good
    // candidates incorrectly flagged (gate - a real exchange whose name
    // happens to also be a common English word).
    expect(badFlagged.sort()).toEqual(["blend", "current", "sphere", "unit"]);
    expect(goodFlagged).toEqual(["gate"]);

    // Recall this low (under 1 in 5) is not "meaningful separation" by
    // any reasonable pre-specified bar - documented here, not
    // rationalized. This is why buildDiscoveryCandidates never calls
    // distinctivenessPenalty.
    expect(badRecall).toBeLessThan(0.25);
    expect(goodFalsePositiveRate).toBeGreaterThan(0);
  });
});
