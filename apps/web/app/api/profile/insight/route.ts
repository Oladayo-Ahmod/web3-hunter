import { getOrGenerateProfileInsight } from "@web3-hunter/ai";
import { NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function POST() {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const outcome = await getOrGenerateProfileInsight(userId);
  if (!outcome.available) {
    return NextResponse.json({ error: "AI is not currently available" }, { status: 503 });
  }

  return NextResponse.json(outcome.artifact);
}
