import type { Normalizer } from "@web3-hunter/ingestion";
import {
  createHiringJobClosedNormalizer,
  createHiringJobNormalizer,
  type CanonicalJob,
  type JobFields,
} from "../hiring-events";
import { ashbyJobSchema } from "./types";

function toCanonicalJob(payload: unknown): CanonicalJob {
  const job = ashbyJobSchema.parse(payload);
  const departmentName = job.department ?? job.team ?? null;

  const fields: JobFields = {
    externalId: job.id,
    title: job.title,
    locationName: job.location ?? null,
    departmentNames: departmentName ? [departmentName] : [],
    absoluteUrl: job.jobUrl,
  };

  // Ashby's public Job Board API doesn't consistently expose a separate
  // "updated" timestamp — `updatedAt` is used when present, `publishedAt`
  // otherwise (see ./types.ts).
  return { fields, occurredAt: new Date(job.updatedAt ?? job.publishedAt) };
}

/**
 * Builds this Collector's normalizer for one company's Ashby job board.
 * All the canonical-event logic lives in `../hiring-events`, shared with
 * every other ATS Collector — this module supplies only Ashby's own
 * payload shape.
 */
export function createAshbyJobNormalizer(companyId: string): Normalizer {
  return createHiringJobNormalizer(companyId, toCanonicalJob);
}

export function createAshbyJobClosedNormalizer(companyId: string) {
  return createHiringJobClosedNormalizer(companyId, toCanonicalJob);
}
