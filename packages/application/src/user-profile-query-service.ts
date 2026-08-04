import { getDb, schema } from "@web3-hunter/db";
import { eq } from "drizzle-orm";
import type { SkillDTO, UserProfileSummaryDTO } from "./dto";
import { toSkillDTO } from "./mappers";

/**
 * The current state of a User's Profile — for pre-filling the
 * profile-editing form. Reads data `packages/matching` writes, the same
 * "Application Layer reads what any package persisted" pattern already
 * used for `packages/scoring`'s and `packages/classification`'s output.
 * Returns `null` if the User hasn't created a Profile yet (a User Profile
 * "may start minimal," per docs/DOMAIN_MODEL.md, but doesn't exist until
 * the first write).
 */
export async function getUserProfileSummary(userId: string): Promise<UserProfileSummaryDTO | null> {
  const db = getDb();

  const [profileRow] = await db
    .select()
    .from(schema.userProfile)
    .where(eq(schema.userProfile.userId, userId))
    .limit(1);
  if (!profileRow) {
    return null;
  }

  const [skillRows, allSkills] = await Promise.all([
    db.select().from(schema.userSkill).where(eq(schema.userSkill.userId, userId)),
    db.select().from(schema.skill),
  ]);

  const skillById = new Map(allSkills.map((row) => [row.id, toSkillDTO(row)]));

  const isSkill = (skill: SkillDTO | undefined): skill is SkillDTO => skill !== undefined;

  return {
    skills: skillRows.map((row) => skillById.get(row.skillId)).filter(isSkill),
    dealBreakerSkills: profileRow.dealBreakerSkillIds
      .map((skillId) => skillById.get(skillId))
      .filter(isSkill),
  };
}
