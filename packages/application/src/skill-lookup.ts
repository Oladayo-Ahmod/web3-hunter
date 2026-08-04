import { getDb, schema } from "@web3-hunter/db";
import { inArray } from "drizzle-orm";
import type { SkillDTO } from "./dto";
import { toSkillDTO } from "./mappers";

/**
 * Batch-resolves Skill IDs (e.g. from several Matches on one page of
 * results) into displayable Skill entries in a single query, rather than
 * one lookup per Match — the same "resolve once, map over it" shape
 * `listOpportunityFeed` already uses for company data via its join.
 */
export async function resolveSkillsById(
  skillIds: readonly string[],
): Promise<Map<string, SkillDTO>> {
  const uniqueIds = [...new Set(skillIds)];
  if (uniqueIds.length === 0) {
    return new Map();
  }

  const rows = await getDb().select().from(schema.skill).where(inArray(schema.skill.id, uniqueIds));
  return new Map(rows.map((row) => [row.id, toSkillDTO(row)]));
}
