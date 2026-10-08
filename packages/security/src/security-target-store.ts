import { getDb, schema } from "@web3-hunter/db";
import { and, eq } from "drizzle-orm";

export interface CreateSecurityTargetInput {
  slug: string;
  name: string;
  companyId?: string | null;
  repositoryUrl?: string | null;
  chain?: string | null;
  category?: (typeof schema.companyCategory.enumValues)[number] | null;
  status?: (typeof schema.securityTargetStatus.enumValues)[number];
  discoverySource?: string | null;
  discoveredAt?: Date | null;
}

/**
 * Idempotently resolves a Security Target by its unique `slug` — the
 * same "insert, or fetch the row that already exists" pattern
 * `resolveCompanyBySlug` (`apps/web/lib/collectors/run-collector.ts`)
 * uses, so calling this again for an already-known Target is always
 * safe rather than an error.
 */
export async function createSecurityTarget(input: CreateSecurityTargetInput) {
  const db = getDb();

  const [inserted] = await db
    .insert(schema.securityTarget)
    .values({
      slug: input.slug,
      name: input.name,
      companyId: input.companyId ?? null,
      repositoryUrl: input.repositoryUrl ?? null,
      chain: input.chain ?? null,
      category: input.category ?? null,
      status: input.status ?? "active",
      discoverySource: input.discoverySource ?? null,
      discoveredAt: input.discoveredAt ?? null,
    })
    .onConflictDoNothing({ target: schema.securityTarget.slug })
    .returning();

  if (inserted) {
    return inserted;
  }

  const existing = await getSecurityTargetBySlug(input.slug);
  if (!existing) {
    throw new Error(`Failed to resolve Security Target "${input.slug}".`);
  }
  return existing;
}

/**
 * Resolves a Collector-tracked protocol's Security Target through the
 * explicit `security_target_source_identity` mapping — mirrors
 * `resolveCompany` (`apps/web/lib/collectors/run-collector.ts`) exactly:
 * if this Collector has already declared `sourceIdentifier` to mean a
 * particular Security Target, reuse it. Otherwise resolve/create the
 * Security Target by its canonical `slug` via `createSecurityTarget` and
 * record the mapping, so this run and every future one resolve to the
 * identical Security Target deterministically, regardless of poll order.
 */
export async function resolveSecurityTarget(
  collectorId: string,
  sourceIdentifier: string,
  input: CreateSecurityTargetInput,
): Promise<string> {
  const db = getDb();

  const [existingIdentity] = await db
    .select()
    .from(schema.securityTargetSourceIdentity)
    .where(
      and(
        eq(schema.securityTargetSourceIdentity.collectorId, collectorId),
        eq(schema.securityTargetSourceIdentity.sourceIdentifier, sourceIdentifier),
      ),
    )
    .limit(1);

  if (existingIdentity) {
    return existingIdentity.securityTargetId;
  }

  const target = await createSecurityTarget(input);

  await db
    .insert(schema.securityTargetSourceIdentity)
    .values({ collectorId, sourceIdentifier, securityTargetId: target.id })
    .onConflictDoNothing({
      target: [
        schema.securityTargetSourceIdentity.collectorId,
        schema.securityTargetSourceIdentity.sourceIdentifier,
      ],
    });

  return target.id;
}

export async function getSecurityTargetBySlug(slug: string) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.securityTarget)
    .where(eq(schema.securityTarget.slug, slug))
    .limit(1);
  return row ?? null;
}

export async function getSecurityTargetById(id: string) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.securityTarget)
    .where(eq(schema.securityTarget.id, id))
    .limit(1);
  return row ?? null;
}
