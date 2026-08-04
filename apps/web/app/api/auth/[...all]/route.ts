import { toNextJsHandler } from "better-auth/next-js";
import type { NextRequest } from "next/server";
import { getAuth } from "@/lib/auth";

// `getAuth()` is called inside each handler, not at module scope, so that
// constructing the Better Auth instance — and validating its required
// environment variables — happens on first real request, not while Next.js
// imports this route module during `next build`.

export async function GET(request: NextRequest) {
  return toNextJsHandler(getAuth()).GET(request);
}

export async function POST(request: NextRequest) {
  return toNextJsHandler(getAuth()).POST(request);
}
