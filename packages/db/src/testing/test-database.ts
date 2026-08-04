import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import EmbeddedPostgres from "embedded-postgres";
import postgres from "postgres";
import type { Database } from "../client";
import * as schema from "../schema";

const migrationsFolder = fileURLToPath(new URL("../../migrations", import.meta.url));

export interface TestDatabase {
  db: Database;
  /**
   * The instance's connection string. Needed by callers that also want
   * `@web3-hunter/db`'s `getDb()` singleton (used internally by e.g.
   * `@web3-hunter/events`'s `publishEvent`/`replayEvents`) to point at
   * this same instance — set `process.env.DATABASE_URL` to this value
   * before the first call to `getDb()`.
   */
  connectionString: string;
  stop: () => Promise<void>;
}

/**
 * Starts a real, ephemeral Postgres instance — via `embedded-postgres`, an
 * actual Postgres binary, not a mock or a JS emulator — with every
 * migration in packages/db/migrations applied, for integration tests that
 * need to verify genuine database behavior. The append-only triggers in
 * `migrations/0002_revoke_event_mutations.sql` are exactly the kind of
 * thing no amount of TypeScript-level testing can substitute for.
 *
 * No live Supabase project has been provisioned yet (see docs/DATABASE.md
 * §9), so this is what "test against a real database" means until one
 * exists. Each call gets its own data directory and database name, so
 * tests can run concurrently without interfering with each other.
 */
export async function createTestDatabase(): Promise<TestDatabase> {
  const databaseDir = await mkdtemp(join(tmpdir(), "web3-hunter-test-pg-"));
  const port = 40000 + Math.floor(Math.random() * 10000);

  const pg = new EmbeddedPostgres({
    databaseDir,
    port,
    user: "postgres",
    password: "postgres",
    persistent: false,
    onLog: () => {},
    onError: () => {},
  });

  await pg.initialise();
  await pg.start();

  const databaseName = `test_${randomUUID().replaceAll("-", "")}`;
  await pg.createDatabase(databaseName);

  const connectionString = `postgres://postgres:postgres@localhost:${port}/${databaseName}`;
  const queryClient = postgres(connectionString, { max: 1 });
  const db = drizzle(queryClient, { schema });

  await migrate(db, { migrationsFolder });

  return {
    db,
    connectionString,
    stop: async () => {
      await queryClient.end({ timeout: 5 });
      await pg.stop();
      await rm(databaseDir, { recursive: true, force: true });
    },
  };
}
