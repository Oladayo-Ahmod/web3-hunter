import { getCompanyProfile } from "@web3-hunter/application";
import { NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const viewerId = await getCurrentUserId();
  const profile = await getCompanyProfile(slug, viewerId);

  if (!profile) {
    return NextResponse.json({ error: "Company not found" }, { status: 404 });
  }

  return NextResponse.json(profile);
}
