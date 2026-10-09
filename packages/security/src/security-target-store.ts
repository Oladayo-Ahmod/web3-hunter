import { getDb, schema } from "@web3-hunter/db";
import { and, desc, eq, isNull } from "drizzle-orm";

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
 * The GitHub organization/user segment of a `github.com/...` URL
 * (case-insensitive), or `null` if the URL isn't a recognizable GitHub
 * URL at all. This is the coarsest, most generic level two
 * `repositoryUrl` values can be compared at — some sources (DefiLlama)
 * only ever supply an organization, never a specific repository, so a
 * full-path comparison (`normalizeRepositoryUrl`) would never match even
 * for the exact same real-world project. Same organization is still
 * meaningfully strong identity evidence (far stronger than a bare slug
 * string), just coarser than a full matching repo path.
 */
function extractGithubOwner(url: string): string | null {
  const match = /github\.com\/([^/\s]+)/i.exec(url);
  return match ? match[1]!.toLowerCase() : null;
}

/**
 * Whether two `repositoryUrl` values refer to the same real-world
 * identity evidence: if both are GitHub URLs, compared by organization
 * (the finest granularity some sources can ever supply); otherwise,
 * compared as full normalized strings (`normalizeRepositoryUrl`'s
 * existing, unchanged behavior) — e.g. for a future non-GitHub source.
 */
function repositoryUrlsMatch(a: string, b: string): boolean {
  const ownerA = extractGithubOwner(a);
  const ownerB = extractGithubOwner(b);
  if (ownerA && ownerB) {
    return ownerA === ownerB;
  }
  return normalizeRepositoryUrl(a) === normalizeRepositoryUrl(b);
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

  if (!repositoryUrlsMatch(existingUrl, incomingUrl)) {
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

/**
 * Reads back the most recent stored Raw Record payload a *named*
 * Collector captured for a given Security Target, via its existing
 * `security_target_source_identity` mapping — e.g. so a later Collector
 * hitting an identity collision can look for repair evidence an earlier
 * Collector already fetched and stored, without a fresh live request.
 * Returns `null` if that Collector never resolved this Security Target
 * at all (no mapping exists) or has no stored payload for it.
 *
 * Deliberately generic: this function has no knowledge of any one
 * Collector's payload shape — interpreting the returned `unknown` is the
 * caller's job (e.g. `@web3-hunter/collectors`'
 * `deriveRepositoryUrlFromDefiLlamaPayload`), consistent with
 * `packages/security` never depending on `packages/collectors`.
 */
export async function getRawPayloadFromCollector(
  securityTargetId: string,
  collectorSlug: string,
): Promise<unknown | null> {
  const db = getDb();

  const [identity] = await db
    .select({ sourceIdentifier: schema.securityTargetSourceIdentity.sourceIdentifier })
    .from(schema.securityTargetSourceIdentity)
    .innerJoin(
      schema.collector,
      eq(schema.collector.id, schema.securityTargetSourceIdentity.collectorId),
    )
    .where(
      and(
        eq(schema.securityTargetSourceIdentity.securityTargetId, securityTargetId),
        eq(schema.collector.slug, collectorSlug),
      ),
    )
    .limit(1);

  if (!identity) {
    return null;
  }

  const [rawRecord] = await db
    .select({ payload: schema.rawRecord.payload })
    .from(schema.rawRecord)
    .innerJoin(schema.collector, eq(schema.collector.id, schema.rawRecord.collectorId))
    .where(
      and(
        eq(schema.collector.slug, collectorSlug),
        eq(schema.rawRecord.sourceIdentifier, identity.sourceIdentifier),
      ),
    )
    // Raw Record ids are time-sortable (UUIDv7) — highest id is the most recent capture.
    .orderBy(desc(schema.rawRecord.id))
    .limit(1);

  return rawRecord?.payload ?? null;
}

/**
 * Attaches repository evidence to a Security Target **only** when it
 * currently has none — a narrowly-scoped, conditional update that can
 * never overwrite or clobber existing (possibly conflicting) evidence,
 * enforced at the SQL level (`WHERE repository_url IS NULL`), not by an
 * application-level check-then-act that a race could undermine.
 */
export async function updateSecurityTargetRepositoryUrlIfMissing(
  securityTargetId: string,
  repositoryUrl: string,
): Promise<boolean> {
  const updated = await getDb()
    .update(schema.securityTarget)
    .set({ repositoryUrl })
    .where(
      and(
        eq(schema.securityTarget.id, securityTargetId),
        isNull(schema.securityTarget.repositoryUrl),
      ),
    )
    .returning({ id: schema.securityTarget.id });

  return updated.length > 0;
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
