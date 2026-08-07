import { runAshbyCollector } from "@/lib/collectors/run-ashby";
import { getTrackedCompaniesForCollector } from "@/lib/collectors/tracked-companies-from-directory";
import { authorizeCronRequest, cronStageResponse } from "@/lib/cron/shared";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * One of the independently-schedulable cron entry points — see
 * `../collect-greenhouse/route.ts`'s doc comment for the shared
 * rationale. Wired for the first time in Milestone 11, once the
 * pre-existing Ashby collector logic had a tracked company to run
 * against.
 */
async function handler(request: Request) {
  const unauthorized = authorizeCronRequest(request);
  if (unauthorized) {
    return unauthorized;
  }

  const tracked = await getTrackedCompaniesForCollector("ashby");
  const results = await runAshbyCollector(
    tracked.map(({ sourceIdentifier, ...rest }) => ({ ...rest, boardName: sourceIdentifier })),
  );
  return cronStageResponse("collectAshby", results);
}

export async function GET(request: Request) {
  return handler(request);
}

export async function POST(request: Request) {
  return handler(request);
}
