"use client";

import { createAuthClient } from "better-auth/react";

/**
 * The browser-side Better Auth client — used by the sign-up/sign-in forms
 * only. Reads `NEXT_PUBLIC_APP_URL` directly (not via `getEnv()`, which
 * validates server-only variables too and isn't meant to run in the
 * browser bundle).
 */
export const authClient = createAuthClient({
  baseURL: process.env.NEXT_PUBLIC_APP_URL,
});
