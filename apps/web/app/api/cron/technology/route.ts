import { authorizeCronRequest, cronStageResponse } from "@/lib/cron/shared";
import { detectTechnologyForAllCompanies } from "@/lib/pipeline/stages";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * One of 7 independently-schedulable cron entry points — see
 * `../collect-greenhouse/route.ts`'s doc comment for the shared
 * rationale. Depends only on the GitHub Collector having already run —
 * independent of Scoring/Classification, so this can run on its own
 * schedule with no ordering concern relative to those two.
 */
async function handler(request: Request) {
  const unauthorized = authorizeCronRequest(request);
  if (unauthorized) {
    return unauthorized;
  }

  const results = await detectTechnologyForAllCompanies();
  return cronStageResponse("technology", results);
}

export async function GET(request: Request) {
  return handler(request);
}

export async function POST(request: Request) {
  return handler(request);
}
