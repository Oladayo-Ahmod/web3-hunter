import { getOrGenerateOpportunitySummary } from "@web3-hunter/ai";
import { getOpportunityDetail } from "@web3-hunter/application";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Public, unauthenticated — Opportunity data is already public (see the Opportunity Feed), so its AI summary is too. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const opportunity = await getOpportunityDetail(id);
  if (!opportunity) {
    return NextResponse.json({ error: "Opportunity not found" }, { status: 404 });
  }

  const outcome = await getOrGenerateOpportunitySummary(id);
  if (!outcome.available) {
    return NextResponse.json({ error: "AI is not currently available" }, { status: 503 });
  }

  return NextResponse.json(outcome.artifact);
}
