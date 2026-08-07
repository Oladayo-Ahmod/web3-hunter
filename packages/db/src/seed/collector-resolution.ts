import { eq } from "drizzle-orm";
import type { Database } from "../client";
import { collector } from "../schema";

/**
 * Resolves a Collector's row by `slug`, creating it if this is the first
 * time it's been referenced — identical semantics regardless of whether
 * the caller is an actual Collector run (`apps/web/lib/collectors/
 * run-collector.ts`) resolving it reactively, on first fetch, or the
 * Milestone 11 company-directory seed (./company-directory.ts) resolving
 * it proactively, before any Collector has ever run. Moved here, shared,
 * rather than duplicated between the two — both need the exact same
 * "insert, or reuse if it already exists" operation, and `packages/db` is
 * the one place both can reach without crossing the dependency direction
 * `apps/web` -> `packages/db` (never the reverse).
 */
export async function resolveOrCreateCollector(
  db: Database,
  slug: string,
  sourceType: string,
): Promise<string> {
  const [created] = await db
    .insert(collector)
    .values({ slug, sourceType })
    .onConflictDoNothing({ target: collector.slug })
    .returning();

  if (created) {
    return created.id;
  }

  const [existing] = await db.select().from(collector).where(eq(collector.slug, slug)).limit(1);

  if (!existing) {
    throw new Error(`Failed to resolve the "${slug}" collector row.`);
  }

  return existing.id;
}
