import { getDb, schema } from "@web3-hunter/db";
import { asc, eq } from "drizzle-orm";
import {
  computeCompanyTechnologyProfile,
  technologyProfileStatesEqual,
} from "./technology-profile";
import type { CompanyTechnologyProfileState, TechnologyDetectionSummary } from "./types";

async function getCompanyTechnologyDetections(
  companyId: string,
): Promise<TechnologyDetectionSummary[]> {
  const rows = await getDb()
    .select()
    .from(schema.technologyDetection)
    .where(eq(schema.technologyDetection.companyId, companyId))
    .orderBy(asc(schema.technologyDetection.detectedAt), asc(schema.technologyDetection.id));

  return rows.map((row) => ({ id: row.id, skillId: row.skillId, detectedAt: row.detectedAt }));
}

async function currentProjection(companyId: string): Promise<CompanyTechnologyProfileState | null> {
  const [row] = await getDb()
    .select()
    .from(schema.companyTechnologyProfile)
    .where(eq(schema.companyTechnologyProfile.companyId, companyId))
    .limit(1);

  if (!row) {
    return null;
  }

  return { skillIds: row.skillIds, evidenceCount: row.evidenceCount };
}

async function upsertProjection(
  companyId: string,
  state: CompanyTechnologyProfileState,
  asOf: Date,
): Promise<void> {
  await getDb()
    .insert(schema.companyTechnologyProfile)
    .values({
      companyId,
      skillIds: [...state.skillIds],
      evidenceCount: state.evidenceCount,
      asOf,
    })
    .onConflictDoUpdate({
      target: schema.companyTechnologyProfile.companyId,
      set: {
        skillIds: [...state.skillIds],
        evidenceCount: state.evidenceCount,
        asOf,
        updatedAt: new Date(),
      },
    });
}

/**
 * Recomputes a Company's Technology Profile as of `asOf` from its full
 * `technology_detection` history, and writes it if it has meaningfully
 * changed. Unlike `packages/scoring`'s `updateCompanyIntelligence`, this
 * publishes no event of its own before writing: the rollup is a plain
 * aggregation over already-published `TechnologyDetected` Events, not a
 * new derived insight — the same relationship `opportunity_skill` has to
 * `OpportunitySkillDetected`. Returns the new state, or `null` if nothing
 * meaningfully changed (in which case nothing is written).
 */
export async function updateCompanyTechnologyProfile(
  companyId: string,
  asOf: Date,
): Promise<CompanyTechnologyProfileState | null> {
  const detections = await getCompanyTechnologyDetections(companyId);
  const newState = computeCompanyTechnologyProfile(detections);
  const current = await currentProjection(companyId);

  if (current && technologyProfileStatesEqual(current, newState)) {
    return null;
  }

  await upsertProjection(companyId, newState, asOf);
  return newState;
}

/**
 * Rebuilds a Company's Technology Profile purely by replaying its
 * `technology_detection` history, proving the projection is genuinely
 * derived rather than an independent source of truth (docs/DATABASE.md
 * §1) — the Technology Intelligence counterpart to
 * `packages/scoring`'s `rebuildCompanyIntelligence`.
 */
export async function rebuildCompanyTechnologyProfile(
  companyId: string,
  asOf: Date,
): Promise<CompanyTechnologyProfileState> {
  const detections = await getCompanyTechnologyDetections(companyId);
  const state = computeCompanyTechnologyProfile(detections);

  await upsertProjection(companyId, state, asOf);
  return state;
}
