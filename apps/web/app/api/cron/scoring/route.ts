import { authorizeCronRequest, cronStageResponse } from "@/lib/cron/shared";
import { scoreAllCompanies } from "@/lib/pipeline/stages";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * One of 7 independently-schedulable cron entry points — see
 * `../collect-greenhouse/route.ts`'s doc comment for the shared
 * rationale. Depends on the Collectors having already run.
 */
async function handler(request: Request) {
  const unauthorized = authorizeCronRequest(request);
  if (unauthorized) {
    return unauthorized;
  }

  const results = await scoreAllCompanies();
  return cronStageResponse("scoring", results);
}

export async function GET(request: Request) {
  return handler(request);
}

export async function POST(request: Request) {
  return handler(request);
}
