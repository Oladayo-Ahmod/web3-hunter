import { registerEventType, type NormalizedEvent, type Normalizer } from "@web3-hunter/ingestion";
import { z } from "zod";

/**
 * The canonical repository-facts vocabulary the GitHub Collector
 * normalizes into — `RepositoryDiscovered`/`RepositoryUpdated`, with one
 * shared `RepositoryFields` shape. Mirrors `./hiring-events.ts`'s role for
 * ATS Collectors: the event types are registered once, here, shared —
 * never per-Collector — so a future second VCS source would normalize
 * into this same canonical shape rather than inventing its own.
 *
 * Unlike hiring events, there is no `RepositoryClosed` counterpart: a
 * repository disappearing from an org's listing (deleted, made private)
 * is out of scope for Milestone 9 — see docs/ROADMAP.md's Explicitly Out
 * of Scope. An archived/unarchived transition is just a field change,
 * captured as an ordinary `RepositoryUpdated`.
 */

const repositoryFieldsSchema = z.object({
  externalId: z.string(),
  name: z.string(),
  fullName: z.string(),
  htmlUrl: z.string(),
  description: z.string().nullable(),
  // The repository's primary language, as GitHub reports it (e.g.
  // "Rust", "TypeScript") — a single value, not a full byte-weighted
  // breakdown; see `packages/collectors/github/fetch.ts` for why.
  language: z.string().nullable(),
  topics: z.array(z.string()),
  archived: z.boolean(),
  fork: z.boolean(),
  licenseKey: z.string().nullable(),
  stargazersCount: z.number(),
});

export type RepositoryFields = z.infer<typeof repositoryFieldsSchema>;

const repositoryDiscoveredMetadataSchema = repositoryFieldsSchema;
const repositoryUpdatedMetadataSchema = repositoryFieldsSchema.extend({
  changedFrom: repositoryFieldsSchema.partial(),
});

export const RepositoryDiscovered = registerEventType({
  name: "RepositoryDiscovered",
  category: "source",
  version: 1,
  metadataSchema: repositoryDiscoveredMetadataSchema,
});

export const RepositoryUpdated = registerEventType({
  name: "RepositoryUpdated",
  category: "source",
  version: 1,
  metadataSchema: repositoryUpdatedMetadataSchema,
});

/** A source payload mapped to the canonical shape — the one thing the GitHub Collector's normalizer supplies. */
export interface CanonicalRepository {
  fields: RepositoryFields;
  /** When this repository's state actually last changed, per the source — never wall-clock "now". */
  occurredAt: Date;
}

function diffRepositoryFields(
  current: RepositoryFields,
  previous: RepositoryFields,
): Partial<RepositoryFields> {
  const changedFrom: Partial<RepositoryFields> = {};

  for (const key of Object.keys(current) as (keyof RepositoryFields)[]) {
    if (JSON.stringify(current[key]) !== JSON.stringify(previous[key])) {
      (changedFrom as Record<string, unknown>)[key] = previous[key];
    }
  }

  return changedFrom;
}

/**
 * Builds the GitHub Collector's normalizer for one Company's org. Pure
 * and synchronous, per `Normalizer`'s contract: `toCanonicalRepository`
 * itself must not perform I/O, and neither does this.
 */
export function createRepositoryNormalizer(
  companyId: string,
  toCanonicalRepository: (payload: unknown) => CanonicalRepository,
): Normalizer {
  return (input) => {
    const current = toCanonicalRepository(input.payload);

    if (!input.previousPayload) {
      const event: NormalizedEvent = {
        type: RepositoryDiscovered.name,
        metadata: current.fields,
        occurredAt: current.occurredAt,
        confidence: 1,
        relatedEntityType: "company",
        relatedEntityId: companyId,
      };
      return event;
    }

    const previous = toCanonicalRepository(input.previousPayload);
    const changedFrom = diffRepositoryFields(current.fields, previous.fields);

    if (Object.keys(changedFrom).length === 0) {
      return null;
    }

    const event: NormalizedEvent = {
      type: RepositoryUpdated.name,
      metadata: { ...current.fields, changedFrom },
      occurredAt: current.occurredAt,
      confidence: 1,
      relatedEntityType: "company",
      relatedEntityId: companyId,
    };
    return event;
  };
}
