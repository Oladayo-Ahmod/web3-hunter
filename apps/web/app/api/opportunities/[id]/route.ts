import { getOpportunityDetail } from "@web3-hunter/application";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = await getOpportunityDetail(id);

  if (!detail) {
    return NextResponse.json({ error: "Opportunity not found" }, { status: 404 });
  }

  return NextResponse.json(detail);
}
