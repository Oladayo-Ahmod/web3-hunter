import { listCollectorHealth } from "@web3-hunter/application";
import { NextResponse } from "next/server";

// Collector Health reflects the most recent run at request time; never
// serve it from a build-time snapshot.
export const dynamic = "force-dynamic";

/**
 * Collector Health, per Milestone 8: read-only operational data, no
 * dashboard. Deliberately unauthenticated for now — it exposes no PII or
 * business-sensitive figures, only per-Collector run counters, matching
 * `GET /api/health`'s access level.
 */
export async function GET() {
  const collectors = await listCollectorHealth();
  return NextResponse.json({ collectors });
}
