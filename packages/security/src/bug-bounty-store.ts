import { getDb, schema } from "@web3-hunter/db";
import { eq } from "drizzle-orm";

export interface CreateBugBountyInput {
  securityTargetId?: string | null;
  platform: string;
  status?: (typeof schema.bugBountyStatus.enumValues)[number];
  maxRewardAmount?: string | null;
  scopeUrl?: string | null;
  disclosureUrl?: string | null;
  sourceUrl?: string | null;
}

/**
 * Persists a Bug Bounty reference row — a plain insert, same reasoning
 * as `createAuditContest`: no real source exists yet to define a
 * natural dedup key.
 */
export async function createBugBounty(input: CreateBugBountyInput) {
  const db = getDb();
  const [row] = await db
    .insert(schema.bugBounty)
    .values({
      securityTargetId: input.securityTargetId ?? null,
      platform: input.platform,
      status: input.status ?? "active",
      maxRewardAmount: input.maxRewardAmount ?? null,
      scopeUrl: input.scopeUrl ?? null,
      disclosureUrl: input.disclosureUrl ?? null,
      sourceUrl: input.sourceUrl ?? null,
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
