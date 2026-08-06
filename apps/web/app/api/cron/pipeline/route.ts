import { timingSafeEqual } from "node:crypto";
import { runGithubCollector } from "@/lib/collectors/run-github";
import { runGreenhouseCollector } from "@/lib/collectors/run-greenhouse";
import { TRACKED_GREENHOUSE_COMPANIES } from "@/lib/collectors/tracked-companies";
import { TRACKED_GITHUB_ORGS } from "@/lib/collectors/tracked-github-orgs";
import { getEnv } from "@/lib/env";
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

// Generous ceiling for a cold run against a fresh database (7 chained
// stages, including live ATS/GitHub network calls). Vercel enforces its
// own plan-dependent cap regardless of this value (Hobby: 60s max, Pro:
// configurable higher) - see README's "Automating the pipeline" section.
export const maxDuration = 300;

/**
 * The one HTTP entry point into the deterministic pipeline, added so an
 * external scheduler (cron-job.org, not Vercel Cron - an explicit choice,
 * see README) can trigger it on a schedule. Every architectural
 * constraint this system has held since Milestone 2 - "no queue, no
 * worker, no scheduler inside this codebase" - still holds: this route
 * does not schedule anything itself, it only responds to a request an
 * external service chooses to send, the same as a human running
 * `pnpm --filter @web3-hunter/web collect:greenhouse` by hand.
 *
 * Runs the same 7 recurring stages `apps/web/scripts/run-*.ts` run
 * manually, via the shared logic in `../../../lib/pipeline/stages.ts`
 * (plus the two Collectors, whose library functions were already
 * side-effect-free enough to call directly) - in dependency order,
 * chained in one request rather than 7 separate cron jobs, per the
 * approved design. `seed:skills` is deliberately excluded: it's a
 * one-time setup step, not a recurring job.
 *
 * Authenticated by a shared-secret bearer token (`CRON_SECRET`) rather
 * than a signed-in User session - this is a service-to-service call, not
 * a User-facing one.
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
  const env = getEnv();

  if (!env.CRON_SECRET) {
    return NextResponse.json(
      { error: "CRON_SECRET is not configured on the server" },
      { status: 503 },
    );
  }

  if (!isAuthorized(request, env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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

  await runStage("collectGreenhouse", () => runGreenhouseCollector(TRACKED_GREENHOUSE_COMPANIES));
  await runStage("collectGithub", () => runGithubCollector(TRACKED_GITHUB_ORGS));
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

function isAuthorized(request: Request, secret: string): boolean {
  const header = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  const headerBuffer = Buffer.from(header);
  const expectedBuffer = Buffer.from(expected);

  // Constant-time comparison: a plain `===` would leak how many leading
  // characters matched via response-time differences (OWASP: timing
  // attacks against secret comparison).
  return (
    headerBuffer.length === expectedBuffer.length && timingSafeEqual(headerBuffer, expectedBuffer)
  );
}

/** Every per-entity stage result array (see stages.ts, and the two Collectors' own result types) shares this `{ status: "ok" | "error" }` shape. */
function hasEntityError(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.some(
      (entry) =>
        typeof entry === "object" &&
        entry !== null &&
        "status" in entry &&
        entry.status === "error",
    )
  );
}
