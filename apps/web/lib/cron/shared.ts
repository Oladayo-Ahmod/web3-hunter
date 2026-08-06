import { timingSafeEqual } from "node:crypto";
import { getEnv } from "@/lib/env";
import { NextResponse } from "next/server";

/**
 * The CRON_SECRET bearer-token check every `/api/cron/*` route shares -
 * extracted once every `/api/cron/pipeline/route.ts` grew a sibling per
 * stage (see that file's doc comment for why), rather than duplicating
 * this per route. Returns a ready-to-send response if the request should
 * be rejected (503: not configured, 401: missing/incorrect token), or
 * `null` if the caller should proceed.
 */
export function authorizeCronRequest(request: Request): NextResponse | null {
  const env = getEnv();

  if (!env.CRON_SECRET) {
    return NextResponse.json(
      { error: "CRON_SECRET is not configured on the server" },
      { status: 503 },
    );
  }

  const header = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${env.CRON_SECRET}`;
  const headerBuffer = Buffer.from(header);
  const expectedBuffer = Buffer.from(expected);

  // Constant-time comparison: a plain `===` would leak how many leading
  // characters matched via response-time differences (OWASP: timing
  // attacks against secret comparison).
  const isValid =
    headerBuffer.length === expectedBuffer.length && timingSafeEqual(headerBuffer, expectedBuffer);

  if (!isValid) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return null;
}

/** Every per-entity stage result array (see lib/pipeline/stages.ts, and the two Collectors' own result types) shares this `{ status: "ok" | "error" }` shape. */
export function hasEntityError(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.some(
      (entry) =>
        typeof entry === "object" &&
        entry !== null &&
        "status" in entry &&
        entry.status === "error",
    )
  );
}

/** The standard response shape for a single-stage cron route: 200 if every entity succeeded, 207 if any failed (the rest still ran). */
export function cronStageResponse(stage: string, results: unknown): NextResponse {
  const failed = hasEntityError(results);
  return NextResponse.json({ ok: !failed, stage, results }, { status: failed ? 207 : 200 });
}
