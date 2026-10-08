import { getDb, schema } from "@web3-hunter/db";
import { eq } from "drizzle-orm";

export interface CreateAuditContestInput {
  securityTargetId?: string | null;
  platform: string;
  title: string;
  status?: (typeof schema.auditContestStatus.enumValues)[number];
  startsAt?: Date | null;
  endsAt?: Date | null;
  repositoryUrl?: string | null;
  rewardAmount?: string | null;
  sourceUrl?: string | null;
}

/**
 * Persists an Audit Contest reference row — a plain insert, not an
 * idempotent resolve: there is no real source yet to define a natural
 * dedup key (a title is not guaranteed unique even on one platform —
 * see `audit_contest`'s schema doc comment), so a future Collector is
 * what should decide the dedup rule, not this phase.
 */
export async function createAuditContest(input: CreateAuditContestInput) {
  const db = getDb();
  const [row] = await db
    .insert(schema.auditContest)
    .values({
      securityTargetId: input.securityTargetId ?? null,
      platform: input.platform,
      title: input.title,
      status: input.status ?? "upcoming",
      startsAt: input.startsAt ?? null,
      endsAt: input.endsAt ?? null,
      repositoryUrl: input.repositoryUrl ?? null,
      rewardAmount: input.rewardAmount ?? null,
      sourceUrl: input.sourceUrl ?? null,
    })
    .returning();
  return row!;
}

export async function getAuditContestById(id: string) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.auditContest)
    .where(eq(schema.auditContest.id, id))
    .limit(1);
  return row ?? null;
}
