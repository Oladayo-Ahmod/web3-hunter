import { runGreenhouseCollector } from "@/lib/collectors/run-greenhouse";
import { getTrackedCompaniesForCollector } from "@/lib/collectors/tracked-companies-from-directory";
import { authorizeCronRequest, cronStageResponse } from "@/lib/cron/shared";

export const dynamic = "force-dynamic";
// Milestone 23: raised from 120 after measuring a real production run —
// a full Greenhouse pass over the current curated directory (~500
// companies, several with 100+ postings apiece) took 24m35s wall-clock,
// and Lever/Ashby measured similarly (5m31s / 23m40s). 300 is the
// highest value this route's execution model can meaningfully declare
// (Vercel's own per-plan ceiling still applies on top of this — Hobby
// hard-caps at 60s regardless of what a route declares; Pro's standard
// ceiling is 300s), and it still isn't enough for this route or Ashby's
// at current data volume. This route remains valid for a manual "run
// now" trigger or a non-Vercel (Docker/self-hosted) deployment with no
// serverless time ceiling at all — but the recommended *recurring*
// schedule is `.github/workflows/job-ingestion.yml`, which runs the
// same `runGreenhouseCollector` call from a GitHub Actions job instead
// (up to 6h execution time, comfortably covering the measured
// durations) — see README.md's "Automating the pipeline" section.
export const maxDuration = 300;

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
