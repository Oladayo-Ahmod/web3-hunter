import { dismissRecommendation, InvalidRecommendationTransitionError } from "@web3-hunter/decision";
import { NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const { id } = await params;

  try {
    const status = await dismissRecommendation(id, userId);
    return NextResponse.json({ status });
  } catch (error) {
    if (error instanceof InvalidRecommendationTransitionError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    return NextResponse.json({ error: "Recommendation not found" }, { status: 404 });
  }
}
