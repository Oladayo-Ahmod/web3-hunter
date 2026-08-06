import { authorizeCronRequest, cronStageResponse } from "@/lib/cron/shared";
import { classifyAllOpportunities } from "@/lib/pipeline/stages";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * One of 7 independently-schedulable cron entry points — see
 * `../collect-greenhouse/route.ts`'s doc comment for the shared
 * rationale. Depends on Scoring having already produced a `scored`
 * Opportunity.
 */
async function handler(request: Request) {
  const unauthorized = authorizeCronRequest(request);
  if (unauthorized) {
    return unauthorized;
  }

  const results = await classifyAllOpportunities();
  return cronStageResponse("classification", results);
}

export async function GET(request: Request) {
  return handler(request);
}

export async function POST(request: Request) {
  return handler(request);
}
