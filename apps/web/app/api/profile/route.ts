import { runMatchingPipeline, setDealBreakerSkills, setUserSkills } from "@web3-hunter/matching";
import { NextResponse } from "next/server";
import { z } from "zod";
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

  // Recompute this User's Matches immediately, so the feed reflects their
  // updated Profile on the very next page load rather than waiting for a
  // separate scheduled run.
  const result = await runMatchingPipeline(userId);

  return NextResponse.json({ ok: true, ...result });
}
