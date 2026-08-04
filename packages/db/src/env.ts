import { createEnv } from "@web3-hunter/shared";
import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z
    .string()
    .min(1, "DATABASE_URL is required")
    .refine(
      (value) => value.startsWith("postgres://") || value.startsWith("postgresql://"),
      "DATABASE_URL must be a valid PostgreSQL connection string",
    ),
});

type DbEnv = z.infer<typeof schema>;

let cached: DbEnv | undefined;

/**
 * Validates and returns this package's required environment variables,
 * memoized after the first call. Deliberately lazy rather than validated at
 * module import time: importing `@web3-hunter/db` (e.g. during bundling or
 * static analysis) must never have the side effect of requiring a live
 * DATABASE_URL — only actually using the database client should.
 */
export function getDbEnv(): DbEnv {
  cached ??= createEnv(schema);
  return cached;
}
