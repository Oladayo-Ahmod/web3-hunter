import { runGithubCollector } from "@/lib/collectors/run-github";
import { TRACKED_GITHUB_ORGS } from "@/lib/collectors/tracked-github-orgs";
import { authorizeCronRequest, cronStageResponse } from "@/lib/cron/shared";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * One of 7 independently-schedulable cron entry points — see
 * `../collect-greenhouse/route.ts`'s doc comment for the shared
 * rationale. Scheduling this on its own, separately from the other 6
 * stages, also matters for a reason specific to this one: without
 * GITHUB_TOKEN configured, GitHub's unauthenticated rate limit
 * (60 requests/hour) is easy to exhaust if this stage runs as often as
 * the others — an independent, less-frequent schedule for this endpoint
 * is a reasonable way to manage that without code changes.
 */
async function handler(request: Request) {
  const unauthorized = authorizeCronRequest(request);
  if (unauthorized) {
    return unauthorized;
  }

  const results = await runGithubCollector(TRACKED_GITHUB_ORGS);
  return cronStageResponse("collectGithub", results);
}

export async function GET(request: Request) {
  return handler(request);
}

export async function POST(request: Request) {
  return handler(request);
}
