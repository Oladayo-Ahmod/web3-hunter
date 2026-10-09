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

/**
 * Thrown by `resolveSecurityTargetWithCollisionCheck` when a Collector's
 * `slug` matches a Security Target that another Collector already
 * created, and there is not enough identity evidence to confirm it is
 * the same real-world protocol. Carries the facts a caller needs to
 * surface the collision (e.g. in Collector Health / a per-entity error
 * result) rather than guessing.
 */
export class SecurityTargetIdentityCollisionError extends Error {
  constructor(
    public readonly slug: string,
    public readonly existingSecurityTargetId: string,
    reason: string,
  ) {
    super(
      `Security Target slug "${slug}" already exists (id "${existingSecurityTargetId}"), created ` +
        `by a different Collector, and ${reason}. Refusing to silently merge or fork — see ` +
        "resolveSecurityTargetWithCollisionCheck's doc comment.",
    );
    this.name = "SecurityTargetIdentityCollisionError";
  }
}

/** Case/trailing-slash/`.git`-suffix-insensitive equality for repository URLs — the only identity evidence currently available (see doc comment below). */
function normalizeRepositoryUrl(url: string): string {
  return url
    .trim()
    .toLowerCase()
    .replace(/\.git$/, "")
    .replace(/\/+$/, "");
}

/**
 * The same resolution `resolveSecurityTarget` performs, except when a
 * *different* Collector already created a Security Target under this
 * exact `slug`: rather than silently reusing it (an unrelated project
 * could coincidentally pick the same slug string) or silently creating a
 * duplicate under a forced-unique slug, this compares the one piece of
 * cross-source identity evidence this schema currently carries —
 * `repositoryUrl` — and only proceeds when that comparison is confident:
 *
 * - Both sides have a `repositoryUrl` and they match (normalized) ->
 *   confirmed the same real-world protocol; record this Collector's
 *   identity mapping to the existing Security Target.
 * - Both sides have a `repositoryUrl` and they differ -> confirmed
 *   *different* protocols that merely share a slug string; throws
 *   `SecurityTargetIdentityCollisionError`.
 * - Either side is missing a `repositoryUrl` -> not enough evidence to
 *   decide either way; throws `SecurityTargetIdentityCollisionError`
 *   rather than guessing from the slug string alone or from fuzzy name
 *   matching (deliberately not implemented — see docs/ARCHITECTURE.md's
 *   "no hardcoded, protocol-specific special cases" discipline).
 *
 * A thrown collision is expected to be caught per-entity by the calling
 * Collector (the same per-entity error-isolation every Collector in this
 * system already does), not to abort an entire run.
 */
export async function resolveSecurityTargetWithCollisionCheck(
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

  const existingTargetBySlug = await getSecurityTargetBySlug(input.slug);

  if (!existingTargetBySlug) {
    const target = await createSecurityTarget(input);
    await recordSecurityTargetIdentity(collectorId, sourceIdentifier, target.id);
    return target.id;
  }

  const existingUrl = existingTargetBySlug.repositoryUrl;
  const incomingUrl = input.repositoryUrl;

  if (!existingUrl || !incomingUrl) {
    throw new SecurityTargetIdentityCollisionError(
      input.slug,
      existingTargetBySlug.id,
      "neither side supplies enough repositoryUrl evidence to confirm or rule out a match",
    );
  }

  if (normalizeRepositoryUrl(existingUrl) !== normalizeRepositoryUrl(incomingUrl)) {
    throw new SecurityTargetIdentityCollisionError(
      input.slug,
      existingTargetBySlug.id,
      `the existing Security Target's repositoryUrl ("${existingUrl}") does not match the ` +
        `incoming one ("${incomingUrl}")`,
    );
  }

  await recordSecurityTargetIdentity(collectorId, sourceIdentifier, existingTargetBySlug.id);
  return existingTargetBySlug.id;
}

async function recordSecurityTargetIdentity(
  collectorId: string,
  sourceIdentifier: string,
  securityTargetId: string,
): Promise<void> {
  await getDb()
    .insert(schema.securityTargetSourceIdentity)
    .values({ collectorId, sourceIdentifier, securityTargetId })
    .onConflictDoNothing({
      target: [
        schema.securityTargetSourceIdentity.collectorId,
        schema.securityTargetSourceIdentity.sourceIdentifier,
      ],
    });
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
