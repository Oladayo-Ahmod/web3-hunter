import { registerEventType, type NormalizedEvent, type Normalizer } from "@web3-hunter/ingestion";
import { z } from "zod";
import { greenhouseJobSchema } from "./types";

const jobFieldsSchema = z.object({
  externalId: z.string(),
  title: z.string(),
  locationName: z.string().nullable(),
  departmentNames: z.array(z.string()),
  absoluteUrl: z.string(),
});

type JobFields = z.infer<typeof jobFieldsSchema>;

const jobPostedMetadataSchema = jobFieldsSchema;
const jobUpdatedMetadataSchema = jobFieldsSchema.extend({
  changedFrom: jobFieldsSchema.partial(),
});
const jobClosedMetadataSchema = z.object({
  externalId: z.string(),
  title: z.string(),
  absoluteUrl: z.string(),
});

/** Hiring Events, per docs/EVENT_MODEL.md §Event Categories — registered here because this is the first, and so far only, producer of them. */
export const JobPosted = registerEventType({
  name: "JobPosted",
  category: "source",
  version: 1,
  metadataSchema: jobPostedMetadataSchema,
});

export const JobUpdated = registerEventType({
  name: "JobUpdated",
  category: "source",
  version: 1,
  metadataSchema: jobUpdatedMetadataSchema,
});

export const JobClosed = registerEventType({
  name: "JobClosed",
  category: "source",
  version: 1,
  metadataSchema: jobClosedMetadataSchema,
});

function toJobFields(job: z.infer<typeof greenhouseJobSchema>): JobFields {
  return {
    externalId: String(job.id),
    title: job.title,
    locationName: job.location?.name ?? null,
    departmentNames: (job.departments ?? []).map((department) => department.name),
    absoluteUrl: job.absolute_url,
  };
}

function diffJobFields(current: JobFields, previous: JobFields): Partial<JobFields> {
  const changedFrom: Partial<JobFields> = {};

  for (const key of Object.keys(current) as (keyof JobFields)[]) {
    if (JSON.stringify(current[key]) !== JSON.stringify(previous[key])) {
      (changedFrom as Record<string, unknown>)[key] = previous[key];
    }
  }

  return changedFrom;
}

/**
 * Builds this Collector's normalizer for one company's board. Pure and
 * synchronous, per `Normalizer`'s contract: it never queries anything
 * itself — `runIngestionPipeline` supplies `previousPayload` so this
 * function can tell a new posting from a changed one without any I/O of
 * its own.
 */
export function createGreenhouseJobNormalizer(companyId: string): Normalizer {
  return (input) => {
    const job = greenhouseJobSchema.parse(input.payload);
    const fields = toJobFields(job);
    const occurredAt = new Date(job.updated_at);

    if (!input.previousPayload) {
      const event: NormalizedEvent = {
        type: JobPosted.name,
        metadata: fields,
        occurredAt,
        confidence: 1,
        relatedEntityType: "company",
        relatedEntityId: companyId,
      };
      return event;
    }

    const previousFields = toJobFields(greenhouseJobSchema.parse(input.previousPayload));
    const changedFrom = diffJobFields(fields, previousFields);

    if (Object.keys(changedFrom).length === 0) {
      return null;
    }

    const event: NormalizedEvent = {
      type: JobUpdated.name,
      metadata: { ...fields, changedFrom },
      occurredAt,
      confidence: 1,
      relatedEntityType: "company",
      relatedEntityId: companyId,
    };
    return event;
  };
}

/**
 * Builds the counterpart used for reconciliation (`reconcileMissingRecords`):
 * a role that's disappeared from a poll is represented by a `JobClosed`
 * event citing the last Raw Record captured while it was still open.
 */
export function createGreenhouseJobClosedNormalizer(companyId: string) {
  return (input: { externalId: string; lastKnownPayload: unknown }): NormalizedEvent | null => {
    const job = greenhouseJobSchema.parse(input.lastKnownPayload);

    return {
      type: JobClosed.name,
      metadata: {
        externalId: input.externalId,
        title: job.title,
        absoluteUrl: job.absolute_url,
      },
      occurredAt: new Date(),
      confidence: 1,
      relatedEntityType: "company",
      relatedEntityId: companyId,
    };
  };
}
