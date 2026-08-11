import type { Normalizer } from "@web3-hunter/ingestion";
import {
  createHiringJobClosedNormalizer,
  createHiringJobNormalizer,
  type CanonicalJob,
  type JobFields,
} from "../hiring-events";
import { stripHtmlToPlainText } from "../job-field-normalization";
import { greenhouseJobSchema } from "./types";

function toCanonicalJob(payload: unknown): CanonicalJob {
  const job = greenhouseJobSchema.parse(payload);
  const fields: JobFields = {
    externalId: String(job.id),
    title: job.title,
    locationName: job.location?.name ?? null,
    departmentNames: (job.departments ?? []).map((department) => department.name),
    absoluteUrl: job.absolute_url,
    description: job.content ? stripHtmlToPlainText(job.content) : null,
    // Greenhouse's public Job Board API has no structured field for
    // either of these — never guessed from free text.
    employmentType: null,
    workplaceType: null,
  };
  return { fields, occurredAt: new Date(job.updated_at) };
}

/**
 * Builds this Collector's normalizer for one company's board. All the
 * canonical-event logic (Posted vs. Updated vs. skip, `JobClosed`
 * construction) lives in `../hiring-events`, shared with every other ATS
 * Collector — this module supplies only Greenhouse's own payload shape.
 */
export function createGreenhouseJobNormalizer(companyId: string): Normalizer {
  return createHiringJobNormalizer(companyId, toCanonicalJob);
}

export function createGreenhouseJobClosedNormalizer(companyId: string) {
  return createHiringJobClosedNormalizer(companyId, toCanonicalJob);
}
