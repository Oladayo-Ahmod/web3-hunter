import { NextResponse } from "next/server";
import { checkDatabaseHealth } from "@/lib/health";

// Must never be statically generated: a health check has to reflect live
// state on every request, and evaluating it at build time would require a
// reachable database the build environment may not have.
export const dynamic = "force-dynamic";

export async function GET() {
  const result = await checkDatabaseHealth();

  return NextResponse.json(result, { status: result.status === "ok" ? 200 : 503 });
}
