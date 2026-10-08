import { authorizeCronRequest, cronStageResponse } from "@/lib/cron/shared";
import { scoreAllSecurityTargets } from "@/lib/pipeline/stages";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * One of this system's independently-schedulable cron entry points — see
 * `../collect-greenhouse/route.ts`'s doc comment for the shared
 * rationale. Depends on `collect-defillama` having already run.
 */
async function handler(request: Request) {
  const unauthorized = authorizeCronRequest(request);
  if (unauthorized) {
    return unauthorized;
  }

  const results = await scoreAllSecurityTargets();
  return cronStageResponse("securityScoring", results);
}

export async function GET(request: Request) {
  return handler(request);
}

export async function POST(request: Request) {
  return handler(request);
}
