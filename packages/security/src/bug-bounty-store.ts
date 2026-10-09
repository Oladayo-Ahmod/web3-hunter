import { getDb, schema } from "@web3-hunter/db";
import { and, eq } from "drizzle-orm";

export interface UpsertBugBountyInput {
  securityTargetId?: string | null;
  platform: string;
  status?: (typeof schema.bugBountyStatus.enumValues)[number];
  maxRewardAmount?: string | null;
  scopeUrl?: string | null;
  disclosureUrl?: string | null;
  sourceUrl?: string | null;
}

/**
 * Idempotently writes a Bug Bounty program's current, plain descriptive
 * state — mirrors `resolveSecurityTarget`/`upsertSecurityTargetIntelligence`'s
 * "insert, or update the row that already exists" pattern, now that a
 * real source (Immunefi) gives this table a natural dedup key when a
 * Security Target has been resolved: `(securityTargetId, platform)` (see
 * that unique constraint's doc comment in
 * `packages/db/src/schema/bug-bounty.ts`).
 *
 * Without a resolved `securityTargetId`, there is still no natural dedup
 * key (Postgres never matches `NULL` against `NULL` for `ON CONFLICT`
 * purposes anyway) — falls back to a plain insert, the same behavior
 * Phase 1's `createBugBounty` documented for this case.
 *
 * Deliberately a plain state sync, not Event-sourced: `status`/
 * `maxRewardAmount`/etc. are current facts a Collector observes
 * directly, the same category as `security_target`'s own descriptive
 * columns (`name`, `chain`) — not interpreted evidence. The *meaning* of
 * a pause/resume/scope change (whether it's worth a researcher's
 * attention) is a Security Signal, derived separately by
 * `packages/security`'s detectors from the Source Events a Collector
 * publishes; this function only keeps the reference row current.
 */
export async function upsertBugBounty(input: UpsertBugBountyInput) {
  const db = getDb();
  const values = {
    platform: input.platform,
    status: input.status ?? "active",
    maxRewardAmount: input.maxRewardAmount ?? null,
    scopeUrl: input.scopeUrl ?? null,
    disclosureUrl: input.disclosureUrl ?? null,
    sourceUrl: input.sourceUrl ?? null,
  };

  if (!input.securityTargetId) {
    const [row] = await db
      .insert(schema.bugBounty)
      .values({ ...values, securityTargetId: null })
      .returning();
    return row!;
  }

  const [row] = await db
    .insert(schema.bugBounty)
    .values({ ...values, securityTargetId: input.securityTargetId })
    .onConflictDoUpdate({
      target: [schema.bugBounty.securityTargetId, schema.bugBounty.platform],
      set: { ...values, updatedAt: new Date() },
    })
    .returning();
  return row!;
}

export async function getBugBountyById(id: string) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.bugBounty)
    .where(eq(schema.bugBounty.id, id))
    .limit(1);
  return row ?? null;
}

export async function getBugBountyByTargetAndPlatform(securityTargetId: string, platform: string) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.bugBounty)
    .where(
      and(
        eq(schema.bugBounty.securityTargetId, securityTargetId),
        eq(schema.bugBounty.platform, platform),
      ),
    )
    .limit(1);
  return row ?? null;
}
