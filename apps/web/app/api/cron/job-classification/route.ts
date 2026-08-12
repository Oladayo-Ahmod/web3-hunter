import { authorizeCronRequest, cronStageResponse } from "@/lib/cron/shared";
import { classifyJobsForAllCompanies } from "@/lib/pipeline/stages";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Job-level Skill classification — Milestone 13 Phase 2. Depends only on
 * the ATS Collectors having already run (it reads their `JobPosted`
 * Events); independent of Company-level Scoring/Classification/
 * Technology/Matching, so this can run on its own schedule with no
 * ordering concern relative to those.
 */
async function handler(request: Request) {
  const unauthorized = authorizeCronRequest(request);
  if (unauthorized) {
    return unauthorized;
  }

  const results = await classifyJobsForAllCompanies();
  return cronStageResponse("job-classification", results);
}

export async function GET(request: Request) {
  return handler(request);
}

export async function POST(request: Request) {
  return handler(request);
}
