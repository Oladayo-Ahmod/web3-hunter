import { getDb, schema } from "@web3-hunter/db";

export type HealthCheckResult =
  { status: "ok"; latencyMs: number; checkedAt: string } | { status: "error"; message: string };

/**
 * Performs a real read/write against Postgres (via the system_health_check
 * table — see @web3-hunter/db) to prove full-stack connectivity:
 * Next.js -> Drizzle -> Postgres. This is the only database traffic this
 * milestone generates; see docs/ROADMAP.md Milestone 0.
 */
export async function checkDatabaseHealth(): Promise<HealthCheckResult> {
  const startedAt = performance.now();

  try {
    const [row] = await getDb()
      .insert(schema.systemHealthCheck)
      .values({})
      .returning({ createdAt: schema.systemHealthCheck.createdAt });

    if (!row) {
      throw new Error("Health check insert returned no row");
    }

    return {
      status: "ok",
      latencyMs: Math.round(performance.now() - startedAt),
      checkedAt: row.createdAt.toISOString(),
    };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Unknown database error",
    };
  }
}
