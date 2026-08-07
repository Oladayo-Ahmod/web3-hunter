import { runAshbyCollector } from "@/lib/collectors/run-ashby";
import { runGithubCollector } from "@/lib/collectors/run-github";
import { runGreenhouseCollector } from "@/lib/collectors/run-greenhouse";
import { runLeverCollector } from "@/lib/collectors/run-lever";
import { getTrackedCompaniesForCollector } from "@/lib/collectors/tracked-companies-from-directory";
import { authorizeCronRequest, hasEntityError } from "@/lib/cron/shared";
import {
  classifyAllOpportunities,
  decideForAllUsers,
  detectTechnologyForAllCompanies,
  matchAllUsers,
  scoreAllCompanies,
} from "@/lib/pipeline/stages";
import { NextResponse } from "next/server";

// Every stage below does real, live work (network calls, DB writes); never
// serve this from a cache or run it as part of a static build.
export const dynamic = "force-dynamic";

// Generous ceiling for a cold run against a fresh database (9 chained
// stages, including live ATS/GitHub network calls). Vercel enforces its
// own plan-dependent cap regardless of this value (Hobby: 60s max, Pro:
// configurable higher) - see README's "Automating the pipeline" section.
export const maxDuration = 300;

/**
 * The "run everything in one request" entry point into the deterministic
 * pipeline. The 9 per-stage routes under `app/api/cron/` are the
 * per-stage alternative - use those for regular scheduled runs, each on
 * its own cadence and execution-time budget; this route stays around for
 * a manual "run everything now" trigger (e.g. a fresh deploy, a
 * backfill) where chaining every stage in one request is actually what
 * you want.
 *
 * Every architectural constraint this system has held since Milestone 2 -
 * "no queue, no worker, no scheduler inside this codebase" - still holds:
 * this route does not schedule anything itself, it only responds to a
 * request an external service or a human chooses to send, the same as
 * running `pnpm --filter @web3-hunter/web collect:greenhouse` by hand.
 *
 * Tracked companies for every Collector stage come from the curated
 * directory via `getTrackedCompaniesForCollector`, exactly like every
 * per-stage route and CLI script - Milestone 11's replacement for a
 * hardcoded array. `seed:skills` and `seed:companies` are deliberately
 * excluded: both are one-time setup steps, not recurring jobs.
 *
 * Authenticated by the same shared-secret bearer token (`CRON_SECRET`,
 * see `lib/cron/shared.ts`) every `/api/cron/*` route uses - a
 * service-to-service call, not a User-facing one.
 *
 * Accepts both GET and POST: this triggers real work with no request
 * body either way, and cron dispatch services vary on which method they
 * send by default (cron-job.org's own test run uses GET; Vercel Cron
 * always sends GET). Rejecting GET outright, per REST purism, would just
 * mean depending on every scheduler's UI defaulting to POST - not worth
 * it for an endpoint with no body to speak of.
 */
export async function GET(request: Request) {
  return handleCronRequest(request);
}

export async function POST(request: Request) {
  return handleCronRequest(request);
}

async function handleCronRequest(request: Request) {
  const unauthorized = authorizeCronRequest(request);
  if (unauthorized) {
    return unauthorized;
  }

  const stages: Record<string, unknown> = {};
  const stageErrors: string[] = [];

  async function runStage(name: string, run: () => Promise<unknown>) {
    try {
      const result = await run();
      stages[name] = result;
      if (hasEntityError(result)) {
        stageErrors.push(`${name}: one or more entities failed`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      stages[name] = { error: message };
      stageErrors.push(`${name}: ${message}`);
    }
  }

  await runStage("collectGreenhouse", async () => {
    const tracked = await getTrackedCompaniesForCollector("greenhouse");
    return runGreenhouseCollector(
      tracked.map(({ sourceIdentifier, ...rest }) => ({ ...rest, boardToken: sourceIdentifier })),
    );
  });
  await runStage("collectLever", async () => {
    const tracked = await getTrackedCompaniesForCollector("lever");
    return runLeverCollector(
      tracked.map(({ sourceIdentifier, ...rest }) => ({ ...rest, site: sourceIdentifier })),
    );
  });
  await runStage("collectAshby", async () => {
    const tracked = await getTrackedCompaniesForCollector("ashby");
    return runAshbyCollector(
      tracked.map(({ sourceIdentifier, ...rest }) => ({ ...rest, boardName: sourceIdentifier })),
    );
  });
  await runStage("collectGithub", async () => {
    const tracked = await getTrackedCompaniesForCollector("github");
    return runGithubCollector(
      tracked.map(({ sourceIdentifier, ...rest }) => ({ ...rest, org: sourceIdentifier })),
    );
  });
  await runStage("scoring", () => scoreAllCompanies());
  await runStage("classification", () => classifyAllOpportunities());
  await runStage("technology", () => detectTechnologyForAllCompanies());
  await runStage("matching", () => matchAllUsers());
  await runStage("decision", () => decideForAllUsers());

  return NextResponse.json(
    { ok: stageErrors.length === 0, stages, errors: stageErrors },
    { status: stageErrors.length === 0 ? 200 : 207 },
  );
}
