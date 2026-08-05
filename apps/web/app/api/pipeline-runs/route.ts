import { listPipelineRuns, pipelineRunQuerySchema } from "@web3-hunter/application";
import { NextResponse } from "next/server";

// Pipeline Run history reflects the latest invocations at request time;
// never serve it from a build-time snapshot.
export const dynamic = "force-dynamic";

/**
 * Pipeline Run history, per Milestone 10: read-only operational data, no
 * dashboard. Deliberately unauthenticated — it exposes no PII or
 * business-sensitive figures, only per-invocation run counters, matching
 * `GET /api/collectors`'s access level.
 */
export async function GET(request: Request) {
  const searchParams = new URL(request.url).searchParams;
  const parsed = pipelineRunQuerySchema.safeParse(Object.fromEntries(searchParams));

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid query parameters", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const runs = await listPipelineRuns(parsed.data);
  return NextResponse.json({ runs });
}
