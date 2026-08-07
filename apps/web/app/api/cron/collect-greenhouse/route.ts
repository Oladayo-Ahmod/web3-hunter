import { runGreenhouseCollector } from "@/lib/collectors/run-greenhouse";
import { getTrackedCompaniesForCollector } from "@/lib/collectors/tracked-companies-from-directory";
import { authorizeCronRequest, cronStageResponse } from "@/lib/cron/shared";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * One of 7 independently-schedulable cron entry points, split out of the
 * single combined `../pipeline/route.ts` so each stage can run on its
 * own schedule and its own execution-time budget — e.g. Collectors
 * hourly, Decision once a day — without one slow or rate-limited stage
 * delaying every other stage in the same request. `../pipeline/route.ts`
 * still exists for a manual "run everything now" trigger; this is the
 * per-stage alternative for regular scheduled use. Same rationale
 * (external scheduler, not Vercel Cron; no scheduler inside this
 * codebase) and same CRON_SECRET auth as every other `/api/cron/*`
 * route — see `lib/cron/shared.ts`.
 */
async function handler(request: Request) {
  const unauthorized = authorizeCronRequest(request);
  if (unauthorized) {
    return unauthorized;
  }

  const tracked = await getTrackedCompaniesForCollector("greenhouse");
  const results = await runGreenhouseCollector(
    tracked.map(({ sourceIdentifier, ...rest }) => ({ ...rest, boardToken: sourceIdentifier })),
  );
  return cronStageResponse("collectGreenhouse", results);
}

export async function GET(request: Request) {
  return handler(request);
}

export async function POST(request: Request) {
  return handler(request);
}
