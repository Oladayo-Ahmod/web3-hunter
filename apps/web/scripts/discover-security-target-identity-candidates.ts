import { discoverSecurityTargetIdentityCandidates } from "@web3-hunter/security";

/**
 * Read-only cross-collector Security Target identity discovery —
 * Milestone 25 / Stage 8. Issues a single `SELECT` over `security_target`
 * and classifies pairs with different slugs under
 * `classifySecurityTargetIdentityCandidates`'s explicit rules. Never
 * inserts, updates, or deletes anything, and never invokes any
 * collector, scoring, or reconciliation function — this script exists
 * only to answer "are there credible candidate pairs at all," not to
 * act on them.
 *
 *   pnpm --filter @web3-hunter/web exec tsx scripts/discover-security-target-identity-candidates.ts
 *
 * Requires `DATABASE_URL` to already be configured in the environment,
 * exactly like every other script in this directory — this script does
 * not read, log, or otherwise expose that connection string itself.
 */
async function main() {
  const result = await discoverSecurityTargetIdentityCandidates();

  console.log(
    `Inspected ${result.targetsInspected} Security Target(s) ` +
      `(${result.pairwiseComparisons} pairwise comparison(s) — O(n^2); not intended for an arbitrarily large dataset).`,
  );
  console.log(`Found ${result.candidates.length} candidate pair(s).\n`);

  const byClassification = {
    "high-confidence": 0,
    "candidate-only": 0,
    conflict: 0,
    "insufficient-evidence": 0,
  };

  for (const candidate of result.candidates) {
    byClassification[candidate.classification] += 1;
    console.log(
      `[${candidate.classification}] "${candidate.targetA.slug}" <-> "${candidate.targetB.slug}"` +
        (candidate.generatedByNameSimilarityHint
          ? " (surfaced via name/slug similarity hint)"
          : ""),
    );
    for (const fact of candidate.evidence) {
      console.log(`    - ${fact}`);
    }
  }

  console.log("\nCounts by classification:");
  for (const [classification, count] of Object.entries(byClassification)) {
    console.log(`  ${classification}: ${count}`);
  }

  console.log(
    "\nThese classifications describe discovery evidence only — they are not an authorization " +
      "to merge records, and a `conflict` classification does not prove the targets represent " +
      "different real-world protocols (forks, migrations, and multi-repository projects exist).",
  );
}

main().catch((error) => {
  console.error("Identity candidate discovery failed:", error);
  process.exitCode = 1;
});
