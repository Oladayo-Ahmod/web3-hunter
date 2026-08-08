import { jobFeedQuerySchema, listJobFeed } from "@web3-hunter/application";
import { NextResponse } from "next/server";

// Job data changes continuously as new Events land; this must never be
// served from a build-time snapshot.
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const searchParams = new URL(request.url).searchParams;
  const parsed = jobFeedQuerySchema.safeParse(Object.fromEntries(searchParams));

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid query parameters", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const result = await listJobFeed(parsed.data);
  return NextResponse.json(result);
}
