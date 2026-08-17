import { runLeverCollector } from "@/lib/collectors/run-lever";
import { getTrackedCompaniesForCollector } from "@/lib/collectors/tracked-companies-from-directory";
import { authorizeCronRequest, cronStageResponse } from "@/lib/cron/shared";

export const dynamic = "force-dynamic";
// Milestone 23: raised from 120 — see `../collect-greenhouse/route.ts`'s
// doc comment for the measured-duration rationale (this route measured
// 5m31s against the current curated directory). Recurring schedule
// should use `.github/workflows/job-ingestion.yml`, not this route.
export const maxDuration = 300;

/**
 * One of the independently-schedulable cron entry points — see
 * `../collect-greenhouse/route.ts`'s doc comment for the shared
 * rationale. Wired for the first time in Milestone 11, once the
 * pre-existing Lever collector logic had a tracked company to run
 * against.
 */
async function handler(request: Request) {
  const unauthorized = authorizeCronRequest(request);
  if (unauthorized) {
    return unauthorized;
  }

  const tracked = await getTrackedCompaniesForCollector("lever");
  const results = await runLeverCollector(
    tracked.map(({ sourceIdentifier, ...rest }) => ({ ...rest, site: sourceIdentifier })),
  );
  return cronStageResponse("collectLever", results);
}

export async function GET(request: Request) {
  return handler(request);
}

export async function POST(request: Request) {
  return handler(request);
}
