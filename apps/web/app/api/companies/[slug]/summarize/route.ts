import { getOrGenerateCompanySummary } from "@web3-hunter/ai";
import { getCompanyProfile } from "@web3-hunter/application";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Public, unauthenticated — Company data is already public (see the Company page), so its AI summary is too. */
export async function POST(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  const company = await getCompanyProfile(slug);
  if (!company) {
    return NextResponse.json({ error: "Company not found" }, { status: 404 });
  }

  const outcome = await getOrGenerateCompanySummary(company.company.id);
  if (!outcome.available) {
    return NextResponse.json({ error: "AI is not currently available" }, { status: 503 });
  }

  return NextResponse.json(outcome.artifact);
}
