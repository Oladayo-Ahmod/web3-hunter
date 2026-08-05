import type { Normalizer } from "@web3-hunter/ingestion";
import {
  createRepositoryNormalizer,
  type CanonicalRepository,
  type RepositoryFields,
} from "../repository-events";
import { githubRepoSchema } from "./types";

function toCanonicalRepository(payload: unknown): CanonicalRepository {
  const repo = githubRepoSchema.parse(payload);

  const fields: RepositoryFields = {
    externalId: String(repo.id),
    name: repo.name,
    fullName: repo.full_name,
    htmlUrl: repo.html_url,
    description: repo.description,
    language: repo.language,
    topics: repo.topics,
    archived: repo.archived,
    fork: repo.fork,
    licenseKey: repo.license?.key ?? null,
    stargazersCount: repo.stargazers_count,
  };

  return { fields, occurredAt: new Date(repo.pushed_at) };
}

/**
 * Builds this Collector's normalizer for one Company's GitHub org. All
 * the canonical-event logic (Discovered vs. Updated vs. skip) lives in
 * `../repository-events`, shared with any future VCS Collector — this
 * module supplies only GitHub's own payload shape.
 */
export function createGithubRepositoryNormalizer(companyId: string): Normalizer {
  return createRepositoryNormalizer(companyId, toCanonicalRepository);
}
