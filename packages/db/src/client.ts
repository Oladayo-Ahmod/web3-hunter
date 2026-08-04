import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { getDbEnv } from "./env";
import * as schema from "./schema";

export type Database = PostgresJsDatabase<typeof schema>;

let instance: Database | undefined;

/**
 * Returns the shared Drizzle database client, constructing the underlying
 * connection pool lazily on first use rather than at module import time.
 * This keeps importing `@web3-hunter/db` side-effect free — required so
 * that `next build` (which must import every route module to bundle it,
 * even ones marked `force-dynamic`) never needs a live DATABASE_URL.
 * Environment validation and connection still happen eagerly the first time
 * the database is actually queried, preserving fail-fast behavior at
 * runtime.
 */
export function getDb(): Database {
  if (!instance) {
    const env = getDbEnv();
    const queryClient = postgres(env.DATABASE_URL, {
      // Supabase's pooled connection (PgBouncer, transaction mode) does not
      // support server-side prepared statements.
      prepare: false,
    });
    instance = drizzle(queryClient, { schema });
  }
  return instance;
}
