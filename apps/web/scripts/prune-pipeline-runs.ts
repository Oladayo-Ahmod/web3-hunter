import { getDb } from "@web3-hunter/db";
import { sql } from "drizzle-orm";

/**
 * Milestone 24 — retention for `pipeline_run`, pure operational telemetry
 * (see its own doc comment in packages/db/src/schema/pipeline-run.ts) with
 * no product read-dependency: nothing in `/jobs`, `/today`, `/outreach`,
 * scoring, or replay reads this table — its only consumers are humans
 * debugging a pipeline failure.
 *
 * Real production measurement (2026-08-25): 253,813 rows / 83.7MB (29% of
 * the entire database) with NO retention policy — every run of every
 * pipeline, kept forever. Row volume tracked the every-6h enrichment
 * cadence directly (~24k rows/day at 4 runs/day across ~500 Companies ×
 * scoring+classification+technology). Milestone 24 also moved enrichment
 * to a once-daily cadence (see .github/workflows/enrichment.yml), which
 * alone cuts new-row volume by ~4x; this script bounds the *existing*
 * backlog and keeps it bounded going forward.
 *
 * RETENTION WINDOW: 14 days. Chosen, not invented from nothing — long
 * enough to debug "why did last week's run fail" (the only real use of
 * this table), short enough that steady-state size stays small at the
 * new daily cadence (~6k rows/day observed on the lightest recent day ×
 * 14 ≈ 84k rows, versus the 253k-row/no-limit backlog this replaces).
 * Revisit if debugging needs ever require a longer lookback.
 *
 * Deletes in batches (not one unbounded DELETE) so this never holds a
 * long-running lock or bloats a single transaction against production.
 * Idempotent and safe to run daily — see enrichment.yml.
 *
 *   pnpm --filter @web3-hunter/web maintenance:prune-pipeline-runs
 */
const RETENTION_DAYS = 14;
const BATCH_SIZE = 5_000;

async function main() {
  const db = getDb();
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);

  let totalDeleted = 0;
  for (;;) {
    // RETURNING id, rather than relying on a driver-specific affected-row
    // count, so `deleted.length` is correct regardless of driver.
    const deleted = await db.execute<{ id: string }>(sql`
      DELETE FROM pipeline_run
      WHERE id IN (
        SELECT id FROM pipeline_run WHERE recorded_at < ${cutoff.toISOString()} LIMIT ${BATCH_SIZE}
      )
      RETURNING id
    `);
    const count = deleted.length;
    totalDeleted += count;
    console.log(
      `[prune-pipeline-runs] deleted batch of ${count} rows (running total: ${totalDeleted})`,
    );
    if (count < BATCH_SIZE) {
      break;
    }
  }

  console.log(
    `[prune-pipeline-runs] done — deleted ${totalDeleted} rows older than ${RETENTION_DAYS} days (cutoff: ${cutoff.toISOString()}).`,
  );
  process.exit(0);
}

main().catch((error: unknown) => {
  console.error("[prune-pipeline-runs] Fatal error:", error);
  process.exit(1);
});
