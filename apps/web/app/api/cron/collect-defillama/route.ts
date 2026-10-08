import { runDefiLlamaCollector } from "@/lib/collectors/run-defillama";
import { authorizeCronRequest, cronStageResponse } from "@/lib/cron/shared";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * One of this system's independently-schedulable cron entry points — see
 * `../collect-greenhouse/route.ts`'s doc comment for the shared
 * rationale. Fetches DefiLlama's full protocol catalog once per run — no
 * per-entity fan-out the way the ATS/GitHub Collectors have, so there is
 * no `TrackedCompany`-equivalent input to supply here.
 */
async function handler(request: Request) {
  const unauthorized = authorizeCronRequest(request);
  if (unauthorized) {
    return unauthorized;
  }

  const result = await runDefiLlamaCollector();
  return cronStageResponse("collectDefiLlama", result);
}

export async function GET(request: Request) {
  return handler(request);
}

export async function POST(request: Request) {
  return handler(request);
}
