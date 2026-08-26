import { getPipelineHealth } from "@web3-hunter/application";
import { NextResponse } from "next/server";
import { checkDatabaseHealth } from "@/lib/health";

// Must never be statically generated: a health check has to reflect live
// state on every request, and evaluating it at build time would require a
// reachable database the build environment may not have.
export const dynamic = "force-dynamic";

/**
 * Milestone 24 (governing directive, Part 8): data freshness is now part
 * of this route's response, alongside the original Milestone 0 database
 * connectivity check — "the system must not silently become stale." A
 * failure computing pipeline health degrades this field to `null` rather
 * than failing the whole request: database connectivity (the original,
 * narrower purpose of this route) is reported independently below, and a
 * transient pipeline-health query failure shouldn't be indistinguishable
 * from the database itself being down.
 */
export async function GET() {
  const [database, pipeline] = await Promise.all([
    checkDatabaseHealth(),
    getPipelineHealth().catch(() => null),
  ]);

  return NextResponse.json(
    { ...database, pipeline },
    { status: database.status === "ok" ? 200 : 503 },
  );
}
