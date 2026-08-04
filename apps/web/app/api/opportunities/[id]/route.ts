import { getOpportunityDetail } from "@web3-hunter/application";
import { NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewerId = await getCurrentUserId();
  const detail = await getOpportunityDetail(id, viewerId);

  if (!detail) {
    return NextResponse.json({ error: "Opportunity not found" }, { status: 404 });
  }

  return NextResponse.json(detail);
}
