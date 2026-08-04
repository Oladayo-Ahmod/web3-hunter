import { getRecommendationDetail } from "@web3-hunter/application";
import { NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const { id } = await params;
  const detail = await getRecommendationDetail(id, userId);

  if (!detail) {
    return NextResponse.json({ error: "Recommendation not found" }, { status: 404 });
  }

  return NextResponse.json(detail);
}
