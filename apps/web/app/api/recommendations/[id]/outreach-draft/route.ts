import { getOrGenerateOutreachDraft } from "@web3-hunter/ai";
import { getRecommendationDetail } from "@web3-hunter/application";
import { NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const { id } = await params;

  const recommendation = await getRecommendationDetail(id, userId);
  if (!recommendation) {
    return NextResponse.json({ error: "Recommendation not found" }, { status: 404 });
  }

  const outcome = await getOrGenerateOutreachDraft(id);
  if (!outcome.available) {
    return NextResponse.json({ error: "AI is not currently available" }, { status: 503 });
  }

  return NextResponse.json(outcome.artifact);
}
