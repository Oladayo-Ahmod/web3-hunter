import { jobFeedQuerySchema, listJobFeed } from "@web3-hunter/application";
import { NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/session";

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

  // Resolved from the session cookie, never from a query parameter — see
  // apps/web/lib/session.ts, same as /api/opportunities.
  const viewerId = await getCurrentUserId();
  const result = await listJobFeed(parsed.data, viewerId);
  return NextResponse.json(result);
}
