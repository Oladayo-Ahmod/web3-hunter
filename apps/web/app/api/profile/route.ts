import { runDecisionPipeline } from "@web3-hunter/decision";
import { runMatchingPipeline, setDealBreakerSkills, setUserSkills } from "@web3-hunter/matching";
import { NextResponse } from "next/server";
import { z } from "zod";
import { recordPipelineRun } from "@/lib/observability/record-pipeline-run";
import { getCurrentUserId } from "@/lib/session";

export const dynamic = "force-dynamic";

const updateProfileSchema = z.object({
  skillIds: z.array(z.string().uuid()),
  dealBreakerSkillIds: z.array(z.string().uuid()),
});

export async function POST(request: Request) {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const parsed = updateProfileSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request body", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  await setUserSkills(userId, parsed.data.skillIds);
  await setDealBreakerSkills(userId, parsed.data.dealBreakerSkillIds);

  // Recompute this User's Matches, then their Recommendations, immediately
  // — so both the feed and the Recommendation Feed reflect their updated
  // Profile on the very next page load rather than waiting for a separate
  // scheduled run. Wrapped in the same recordPipelineRun instrumentation
  // the periodic scripts use (scripts/run-matching.ts, run-decisions.ts)
  // so this, the only automatic trigger point in the system, is no longer
  // invisible to Pipeline Run history.
  const matchResult = await recordPipelineRun(
    { pipelineName: "matching", scopeType: "user", scopeId: userId },
    () => runMatchingPipeline(userId),
  );
  const decisionResult = await recordPipelineRun(
    { pipelineName: "decision", scopeType: "user", scopeId: userId },
    () => runDecisionPipeline(userId),
  );

  return NextResponse.json({ ok: true, match: matchResult, decision: decisionResult });
}
