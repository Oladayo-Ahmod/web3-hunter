import { getDb, schema } from "@web3-hunter/db";
import { asc } from "drizzle-orm";
import type { SkillDTO } from "./dto";
import { toSkillDTO } from "./mappers";

/** The full Skill taxonomy, alphabetically — for building a Skill picker (e.g. the profile-editing form). */
export async function listSkills(): Promise<SkillDTO[]> {
  const rows = await getDb().select().from(schema.skill).orderBy(asc(schema.skill.name));
  return rows.map(toSkillDTO);
}
