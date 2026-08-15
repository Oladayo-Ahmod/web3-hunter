import { getDb, schema } from "@web3-hunter/db";

/**
 * Direct row-insertion helpers for `packages/application`'s tests. Unlike
 * `packages/scoring`'s integration tests, these do not need to run the
 * scoring pipeline: the Application Layer only reads already-materialized
 * projections, so seeding those projections directly keeps these tests
 * fast and focused on read orchestration, not on the write-side pipeline
 * already covered by `packages/scoring`'s own tests.
 */

export async function seedCompany(overrides: {
  slug: string;
  name?: string;
  discoveryStatus?: "curated" | "discovered" | "verified" | "rejected";
  priority?: "high" | "medium" | "low" | null;
  fundingStage?: string | null;
  recentlyFunded?: boolean;
  fundingDate?: string | null;
  fundingAmount?: string | null;
  fundingSource?: string | null;
}) {
  const db = getDb();
  const [company] = await db
    .insert(schema.company)
    .values({
      slug: overrides.slug,
      name: overrides.name ?? overrides.slug,
      discoveryStatus: overrides.discoveryStatus ?? "curated",
      priority: overrides.priority ?? null,
      fundingStage: overrides.fundingStage ?? null,
      recentlyFunded: overrides.recentlyFunded ?? false,
      fundingDate: overrides.fundingDate ?? null,
      fundingAmount: overrides.fundingAmount ?? null,
      fundingSource: overrides.fundingSource ?? null,
    })
    .returning();
  return company!;
}

/** Milestone 17: a named Outreach Target contact — see `packages/db`'s `company_contact`. */
export async function seedCompanyContact(input: {
  companyId: string;
  name: string;
  role?:
    | "founder"
    | "cofounder"
    | "cto"
    | "head_of_engineering"
    | "security_lead"
    | "protocol_lead"
    | "other";
  profileUrl?: string;
  notes?: string | null;
}) {
  const db = getDb();
  const [row] = await db
    .insert(schema.companyContact)
    .values({
      companyId: input.companyId,
      name: input.name,
      role: input.role ?? "founder",
      profileUrl: input.profileUrl ?? "https://x.com/test",
      notes: input.notes ?? null,
    })
    .returning();
  return row!;
}

export async function seedOpportunity(input: {
  companyId: string;
  opportunityType?: string;
  status?: "detected" | "scored";
  score?: number | null;
  detectionWindow?: string;
  detectedAt?: Date;
  scoredAt?: Date | null;
  reasoning?: string;
}) {
  const db = getDb();
  const [opportunity] = await db
    .insert(schema.opportunity)
    .values({
      id: crypto.randomUUID(),
      companyId: input.companyId,
      opportunityType: input.opportunityType ?? "engineering-hiring-surge",
      detectionWindow: input.detectionWindow ?? "2026-W01",
      status: input.status ?? "detected",
      score: input.score ?? null,
      reasoning: input.reasoning ?? "Test reasoning",
      detectedAt: input.detectedAt ?? new Date(),
      scoredAt: input.scoredAt ?? null,
    })
    .returning();
  return opportunity!;
}

export async function seedSignal(input: {
  companyId: string;
  signalType?: string;
  weight?: number;
  reasoning?: string;
  detectedAt?: Date;
}) {
  const db = getDb();
  const [signal] = await db
    .insert(schema.signal)
    .values({
      id: crypto.randomUUID(),
      companyId: input.companyId,
      signalType: input.signalType ?? "new-backend-role",
      weight: input.weight ?? 0.7,
      reasoning: input.reasoning ?? "Test signal reasoning",
      sourceEventIds: [crypto.randomUUID()],
      detectedAt: input.detectedAt ?? new Date(),
    })
    .returning();
  return signal!;
}

export async function seedCompanyIntelligence(input: {
  companyId: string;
  trend?: "insufficient-data" | "increasing" | "stable" | "decreasing";
  confidence?: number;
  signalCount?: number;
  lastSignalAt?: Date | null;
  asOf?: Date;
}) {
  const db = getDb();
  const [row] = await db
    .insert(schema.companyIntelligence)
    .values({
      companyId: input.companyId,
      trend: input.trend ?? "increasing",
      confidence: input.confidence ?? 0.6,
      signalCount: input.signalCount ?? 3,
      lastSignalAt: input.lastSignalAt ?? new Date(),
      asOf: input.asOf ?? new Date(),
    })
    .returning();
  return row!;
}

export async function seedUser(label: string) {
  const db = getDb();
  const id = crypto.randomUUID();
  await db.insert(schema.user).values({ id, name: label, email: `${label}@example.test` });
  return id;
}

export async function seedSkill(slug: string, name?: string) {
  const db = getDb();
  const [row] = await db
    .insert(schema.skill)
    .values({ slug, name: name ?? slug })
    .returning();
  return row!;
}

export async function seedUserSkill(userId: string, skillId: string) {
  await getDb().insert(schema.userSkill).values({ userId, skillId });
}

export async function seedMatch(input: {
  userId: string;
  opportunityId: string;
  score?: number;
  reasoning?: string;
  matchedSkillIds?: string[];
  matchedTechnologySkillIds?: string[];
  computedAt?: Date;
}) {
  const db = getDb();
  const [row] = await db
    .insert(schema.match)
    .values({
      id: crypto.randomUUID(),
      userId: input.userId,
      opportunityId: input.opportunityId,
      score: input.score ?? 0.5,
      reasoning: input.reasoning ?? "Test match reasoning",
      matchedSkillIds: input.matchedSkillIds ?? [],
      matchedTechnologySkillIds: input.matchedTechnologySkillIds ?? [],
      computedAt: input.computedAt ?? new Date(),
    })
    .returning();
  return row!;
}

/** Milestone 9: a Company's Technology Profile — see `packages/technology`'s `company_technology_profile`. */
export async function seedCompanyTechnologyProfile(input: {
  companyId: string;
  skillIds?: string[];
  evidenceCount?: number;
  asOf?: Date;
}) {
  const db = getDb();
  const [row] = await db
    .insert(schema.companyTechnologyProfile)
    .values({
      companyId: input.companyId,
      skillIds: input.skillIds ?? [],
      evidenceCount: input.evidenceCount ?? input.skillIds?.length ?? 0,
      asOf: input.asOf ?? new Date(),
    })
    .returning();
  return row!;
}

export async function seedRecommendation(input: {
  userId: string;
  matchId: string;
  opportunityId: string;
  status?: "active" | "dismissed" | "archived" | "expired";
  priority?: number;
  reasonCode?: string;
  reasonDetails?: Record<string, unknown>;
  reasonVersion?: number;
  createdAt?: Date;
  statusChangedAt?: Date;
}) {
  const db = getDb();
  const [row] = await db
    .insert(schema.recommendation)
    .values({
      id: crypto.randomUUID(),
      userId: input.userId,
      matchId: input.matchId,
      opportunityId: input.opportunityId,
      status: input.status ?? "active",
      priority: input.priority ?? 0.5,
      reasonCode: input.reasonCode ?? "eligibility-rules-passed",
      reasonDetails: input.reasonDetails ?? { matchScore: 0.8, intelligenceConfidence: 0.6 },
      reasonVersion: input.reasonVersion ?? 1,
      createdAt: input.createdAt ?? new Date(),
      statusChangedAt: input.statusChangedAt ?? new Date(),
    })
    .returning();
  return row!;
}

/** Milestone 10: a Pipeline Run — see `packages/db`'s `pipeline_run`. */
export async function seedPipelineRun(input: {
  pipelineName: string;
  scopeType: string;
  scopeId: string;
  status?: "succeeded" | "failed";
  startedAt?: Date;
  completedAt?: Date;
  durationMs?: number;
  metrics?: Record<string, unknown> | null;
  errorMessage?: string | null;
  recordedAt?: Date;
}) {
  const db = getDb();
  const startedAt = input.startedAt ?? new Date();
  const completedAt = input.completedAt ?? new Date();
  const [row] = await db
    .insert(schema.pipelineRun)
    .values({
      pipelineName: input.pipelineName,
      scopeType: input.scopeType,
      scopeId: input.scopeId,
      status: input.status ?? "succeeded",
      startedAt,
      completedAt,
      durationMs: input.durationMs ?? completedAt.getTime() - startedAt.getTime(),
      metrics: input.metrics ?? (input.status === "failed" ? null : { processed: 1 }),
      errorMessage: input.errorMessage ?? (input.status === "failed" ? "test failure" : null),
      recordedAt: input.recordedAt,
    })
    .returning();
  return row!;
}
