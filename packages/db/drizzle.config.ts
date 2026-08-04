import { defineConfig } from "drizzle-kit";

// Deliberately reads process.env directly, not the strict `dbEnv` runtime
// validator in ./src/env.ts: `drizzle-kit generate` diffs the schema against
// local migration snapshots and needs no live connection, so it must not be
// blocked by an unset DATABASE_URL. `drizzle-kit migrate` does need a real,
// reachable connection string — and will fail with a clear Postgres
// connection error if one isn't provided, which is the correct behavior.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./migrations",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
  strict: true,
  verbose: true,
});
