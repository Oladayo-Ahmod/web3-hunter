import { getDb, schema } from "@web3-hunter/db";

/**
 * Direct row-insertion helpers for `packages/application`'s tests. Unlike
 * `packages/scoring`'s integration tests, these do not need to run the
 * scoring pipeline: the Application Layer only reads already-materialized
 * projections, so seeding those projections directly keeps these tests
 * fast and focused on read orchestration, not on the write-side pipeline
 * already covered by `packages/scoring`'s own tests.
 */

export async function seedCompany(overrides: { slug: string; name?: string }) {
  const db = getDb();
  const [company] = await db
    .insert(schema.company)
    .values({ slug: overrides.slug, name: overrides.name ?? overrides.slug })
    .returning();
  return company!;
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
