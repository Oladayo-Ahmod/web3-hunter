import type { Normalizer } from "@web3-hunter/ingestion";
import {
  createHiringJobClosedNormalizer,
  createHiringJobNormalizer,
  type CanonicalJob,
  type JobFields,
} from "../hiring-events";
import { normalizeEmploymentType, normalizeWorkplaceType } from "../job-field-normalization";
import { leverPostingSchema } from "./types";

function toCanonicalJob(payload: unknown): CanonicalJob {
  const posting = leverPostingSchema.parse(payload);
  const departmentName = posting.categories?.department ?? posting.categories?.team;

  const fields: JobFields = {
    externalId: posting.id,
    title: posting.text,
    locationName: posting.categories?.location ?? null,
    departmentNames: departmentName ? [departmentName] : [],
    absoluteUrl: posting.hostedUrl,
    description: posting.descriptionPlain ?? null,
    employmentType: normalizeEmploymentType(posting.categories?.commitment),
    workplaceType: normalizeWorkplaceType(posting.workplaceType),
  };

  // Lever's public Postings API doesn't consistently expose a separate
  // "updated" timestamp — `updatedAt` is used when present, `createdAt`
  // otherwise (see ./types.ts).
  return { fields, occurredAt: new Date(posting.updatedAt ?? posting.createdAt) };
}

/**
 * Builds this Collector's normalizer for one company's Lever site. All
 * the canonical-event logic lives in `../hiring-events`, shared with
 * every other ATS Collector — this module supplies only Lever's own
 * payload shape.
 */
export function createLeverJobNormalizer(companyId: string): Normalizer {
  return createHiringJobNormalizer(companyId, toCanonicalJob);
}

export function createLeverJobClosedNormalizer(companyId: string) {
  return createHiringJobClosedNormalizer(companyId, toCanonicalJob);
}
