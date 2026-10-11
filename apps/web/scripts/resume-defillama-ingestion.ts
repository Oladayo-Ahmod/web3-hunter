import { resumeDefiLlamaIngestion } from "../lib/collectors/resume-defillama-ingestion";

/**
 * Resumes DefiLlama ingestion for already-persisted raw records that
 * never received a corresponding Event — recovery for the partial
 * failure investigated in Stage 15/16 (a PostgreSQL statement timeout
 * mid-run). Never calls the DefiLlama API; never resolves, creates, or
 * merges Security Targets.
 *
 *   pnpm --filter @web3-hunter/web exec tsx scripts/resume-defillama-ingestion.ts --dry-run
 *   pnpm --filter @web3-hunter/web exec tsx scripts/resume-defillama-ingestion.ts --batch-size=100
 */
function parseArgs(argv: string[]): { dryRun: boolean; batchSize?: number } {
  let dryRun = false;
  let batchSize: number | undefined;

  for (const arg of argv) {
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    const batchSizeMatch = /^--batch-size=(.+)$/.exec(arg);
    if (batchSizeMatch) {
      const parsed = Number(batchSizeMatch[1]);
      if (!Number.isInteger(parsed) || parsed < 1) {
        throw new Error(
          `--batch-size must be a positive integer, received: "${batchSizeMatch[1]}"`,
        );
      }
      batchSize = parsed;
      continue;
    }
    throw new Error(`Unrecognized argument: "${arg}"`);
  }

  return { dryRun, batchSize };
}

async function main() {
  const { dryRun, batchSize } = parseArgs(process.argv.slice(2));
  const result = await resumeDefiLlamaIngestion({ dryRun, batchSize });

  console.log(
    `[resume-defillama-ingestion] eligible=${result.eligible} excluded=${result.excluded.length} ` +
      `attempted=${result.attempted} succeeded=${result.succeeded} failed=${result.failed.length} ` +
      `remaining=${result.remaining}${dryRun ? " (dry run — no ingestion pipeline calls made)" : ""}`,
  );

  for (const exclusion of result.excluded) {
    console.warn(
      `[resume-defillama-ingestion] excluded "${exclusion.sourceIdentifier}": ${exclusion.reason}`,
    );
  }
  for (const failure of result.failed) {
    console.error(
      `[resume-defillama-ingestion] failed "${failure.sourceIdentifier}": ${failure.message}`,
    );
  }

  if (result.failed.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error("[resume-defillama-ingestion] Fatal error:", error);
  process.exit(1);
});
