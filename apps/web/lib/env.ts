import { createEnv } from "@web3-hunter/shared";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  BETTER_AUTH_SECRET: z.string().min(32, "BETTER_AUTH_SECRET must be at least 32 characters long"),
  BETTER_AUTH_URL: z.string().url("BETTER_AUTH_URL must be a valid URL"),
  NEXT_PUBLIC_APP_URL: z.string().url("NEXT_PUBLIC_APP_URL must be a valid URL"),
});

type AppEnv = z.infer<typeof schema>;

let cached: AppEnv | undefined;

/**
 * Validates and returns this app's required environment variables, memoized
 * after the first call. Deliberately lazy rather than validated at module
 * import time — see the equivalent note in @web3-hunter/db's env module.
 */
export function getEnv(): AppEnv {
  cached ??= createEnv(schema);
  return cached;
}
