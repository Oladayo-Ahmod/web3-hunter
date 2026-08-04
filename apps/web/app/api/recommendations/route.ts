import { listRecommendations } from "@web3-hunter/application";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUserId } from "@/lib/session";

export const dynamic = "force-dynamic";

const statusSchema = z.enum(["active", "dismissed", "archived", "expired"]).optional();

export async function GET(request: Request) {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const searchParams = new URL(request.url).searchParams;
  const parsed = statusSchema.safeParse(searchParams.get("status") ?? undefined);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid status filter", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const recommendations = await listRecommendations(userId, parsed.data);
  return NextResponse.json({ items: recommendations });
}
