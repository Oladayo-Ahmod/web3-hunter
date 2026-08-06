import { authorizeCronRequest, cronStageResponse } from "@/lib/cron/shared";
import { matchAllUsers } from "@/lib/pipeline/stages";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * One of 7 independently-schedulable cron entry points — see
 * `../collect-greenhouse/route.ts`'s doc comment for the shared
 * rationale. Depends on Classification for a meaningful result; benefits
 * from, but doesn't require, Technology.
 */
async function handler(request: Request) {
  const unauthorized = authorizeCronRequest(request);
  if (unauthorized) {
    return unauthorized;
  }

  const results = await matchAllUsers();
  return cronStageResponse("matching", results);
}

export async function GET(request: Request) {
  return handler(request);
}

export async function POST(request: Request) {
  return handler(request);
}
