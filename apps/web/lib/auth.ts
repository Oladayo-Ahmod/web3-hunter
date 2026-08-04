import { getDb } from "@web3-hunter/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { getEnv } from "./env";

function createAuth() {
  const env = getEnv();

  return betterAuth({
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(getDb(), {
      provider: "pg",
    }),
    emailAndPassword: {
      enabled: true,
    },
  });
}

type Auth = ReturnType<typeof createAuth>;

let instance: Auth | undefined;

/**
 * Returns the shared Better Auth server instance, constructed lazily on
 * first use for the same reason as `@web3-hunter/db`'s `getDb`: importing
 * this module (e.g. while Next.js collects routes at build time) must never
 * require a live database or a configured secret — only handling a real
 * request should.
 *
 * This installs and wires Better Auth's own account/session schema only.
 * No sign-up/profile UI and no User Profile domain modeling exist yet —
 * that is Milestone 5's work, per docs/ROADMAP.md.
 */
export function getAuth(): Auth {
  instance ??= createAuth();
  return instance;
}
