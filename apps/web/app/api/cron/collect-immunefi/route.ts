import { runImmunefiCollector } from "@/lib/collectors/run-immunefi";
import { authorizeCronRequest, cronStageResponse } from "@/lib/cron/shared";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * One of this system's independently-schedulable cron entry points — see
 * `../collect-greenhouse/route.ts`'s doc comment for the shared
 * rationale. Fetches Immunefi's full bounty catalog once per run — no
 * per-entity fan-out, so there is no `TrackedCompany`-equivalent input
 * to supply here (mirrors `../collect-defillama/route.ts`).
 */
async function handler(request: Request) {
  const unauthorized = authorizeCronRequest(request);
  if (unauthorized) {
    return unauthorized;
  }

  const result = await runImmunefiCollector();
  return cronStageResponse("collectImmunefi", result);
}

export async function GET(request: Request) {
  return handler(request);
}

export async function POST(request: Request) {
  return handler(request);
}
