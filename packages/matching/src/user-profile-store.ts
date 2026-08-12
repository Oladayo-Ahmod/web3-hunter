import { getDb, schema } from "@web3-hunter/db";
import { eq } from "drizzle-orm";
import type { UserProfileState } from "./types";

/**
 * Ensures a User Profile row exists for a User — safe to call repeatedly.
 * A User Profile may start minimal (docs/DOMAIN_MODEL.md §User Profile:
 * "may start minimal"), so this is called before any Skill/preference
 * write rather than requiring a separate "create profile" step.
 */
export async function ensureUserProfile(userId: string): Promise<void> {
  await getDb()
    .insert(schema.userProfile)
    .values({ userId })
    .onConflictDoNothing({ target: schema.userProfile.userId });
}

export async function getUserProfile(userId: string): Promise<UserProfileState | null> {
  const db = getDb();

  const [profileRow] = await db
    .select()
    .from(schema.userProfile)
    .where(eq(schema.userProfile.userId, userId))
    .limit(1);
  if (!profileRow) {
    return null;
  }

  const skillRows = await db
    .select()
    .from(schema.userSkill)
    .where(eq(schema.userSkill.userId, userId));

  return {
    userId,
    skillIds: skillRows.map((row) => row.skillId),
    dealBreakerSkillIds: profileRow.dealBreakerSkillIds,
  };
}

/**
 * Replaces a User's declared Skill set atomically. A full replace rather
 * than an incremental add/remove: the User Profile's Skill list is a
 * single, canonical statement of "what I know today," not an append-only
 * history.
 */
export async function setUserSkills(userId: string, skillIds: readonly string[]): Promise<void> {
  const db = getDb();
  await ensureUserProfile(userId);

  await db.transaction(async (tx) => {
    await tx.delete(schema.userSkill).where(eq(schema.userSkill.userId, userId));
    if (skillIds.length > 0) {
      await tx.insert(schema.userSkill).values(skillIds.map((skillId) => ({ userId, skillId })));
    }
  });
}

export async function setDealBreakerSkills(
  userId: string,
  skillIds: readonly string[],
): Promise<void> {
  const db = getDb();
  await ensureUserProfile(userId);

  await db
    .update(schema.userProfile)
    .set({ dealBreakerSkillIds: [...skillIds], updatedAt: new Date() })
    .where(eq(schema.userProfile.userId, userId));
}

export interface JobHuntPreferences {
  targetRoleSlugs: readonly string[];
  remotePreference: "remote_only" | "remote_friendly" | "no_preference" | null;
  locationConstraint: string | null;
  seniorityPreference: readonly string[];
}

/**
 * Replaces a User's job-hunt preferences (Milestone 13 Phase 2) — the
 * inputs `packages/application/src/job-relevance.ts` reads alongside
 * declared Skills to score individual Jobs. A full replace, same
 * reasoning as `setUserSkills`: this is a single, canonical statement of
 * "what I'm looking for today," not an append-only history. Every field
 * is nullable/empty-array-able and that's a legitimate, final state, not
 * a placeholder — the scorer treats "not set" as "no opinion" (see that
 * module's doc comment), never as an implicit mismatch.
 */
export async function setJobHuntPreferences(
  userId: string,
  preferences: JobHuntPreferences,
): Promise<void> {
  const db = getDb();
  await ensureUserProfile(userId);

  await db
    .update(schema.userProfile)
    .set({
      targetRoleSlugs: [...preferences.targetRoleSlugs],
      remotePreference: preferences.remotePreference,
      locationConstraint: preferences.locationConstraint,
      seniorityPreference: [...preferences.seniorityPreference],
      updatedAt: new Date(),
    })
    .where(eq(schema.userProfile.userId, userId));
}
