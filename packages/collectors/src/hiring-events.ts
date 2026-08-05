import { registerEventType, type NormalizedEvent, type Normalizer } from "@web3-hunter/ingestion";
import { z } from "zod";

/**
 * The canonical hiring-activity vocabulary every ATS Collector normalizes
 * into — JobPosted/JobUpdated/JobClosed, with one shared `JobFields`
 * shape. Per Milestone 8's Definition of Ready ("treat normalization as
 * the canonical boundary"), no Collector registers its own source-specific
 * event types: Greenhouse, Lever, and Ashby all produce these same three
 * types with this same metadata shape, which is what lets
 * `packages/scoring`'s Signal detectors (keyed on the literal string
 * "JobPosted", per docs/ROADMAP.md Milestone 3) work unchanged across
 * every source, and is what "packages/scoring requires no changes to add
 * a Collector" means mechanically, not just by convention.
 *
 * A Collector's only job is supplying `toCanonicalJob`: source payload in,
 * `CanonicalJob` out. Everything else here — the event types, the diffing
 * logic, the Posted/Updated/Closed construction — is shared and never
 * branches on which source is calling it.
 */

const jobFieldsSchema = z.object({
  externalId: z.string(),
  title: z.string(),
  locationName: z.string().nullable(),
  departmentNames: z.array(z.string()),
  absoluteUrl: z.string(),
});

export type JobFields = z.infer<typeof jobFieldsSchema>;

const jobPostedMetadataSchema = jobFieldsSchema;
const jobUpdatedMetadataSchema = jobFieldsSchema.extend({
  changedFrom: jobFieldsSchema.partial(),
});
const jobClosedMetadataSchema = z.object({
  externalId: z.string(),
  title: z.string(),
  absoluteUrl: z.string(),
});

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

/** A source payload mapped to the canonical shape — the one thing each Collector's normalizer supplies. */
export interface CanonicalJob {
  fields: JobFields;
  /** When this posting's state actually last changed, per the source — never wall-clock "now". */
  occurredAt: Date;
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
 * Builds a hiring-events Normalizer for one Company from a source-specific
 * `toCanonicalJob` mapping — the one piece of source knowledge involved.
 * Pure and synchronous, per `Normalizer`'s contract: `toCanonicalJob`
 * itself must not perform I/O, and neither does this.
 */
export function createHiringJobNormalizer(
  companyId: string,
  toCanonicalJob: (payload: unknown) => CanonicalJob,
): Normalizer {
  return (input) => {
    const current = toCanonicalJob(input.payload);

    if (!input.previousPayload) {
      const event: NormalizedEvent = {
        type: JobPosted.name,
        metadata: current.fields,
        occurredAt: current.occurredAt,
        confidence: 1,
        relatedEntityType: "company",
        relatedEntityId: companyId,
      };
      return event;
    }

    const previous = toCanonicalJob(input.previousPayload);
    const changedFrom = diffJobFields(current.fields, previous.fields);

    if (Object.keys(changedFrom).length === 0) {
      return null;
    }

    const event: NormalizedEvent = {
      type: JobUpdated.name,
      metadata: { ...current.fields, changedFrom },
      occurredAt: current.occurredAt,
      confidence: 1,
      relatedEntityType: "company",
      relatedEntityId: companyId,
    };
    return event;
  };
}

/**
 * The counterpart used for reconciliation (`reconcileMissingRecords`): a
 * role that's disappeared from a poll is represented by a `JobClosed`
 * event citing the last Raw Record captured while it was still open.
 */
export function createHiringJobClosedNormalizer(
  companyId: string,
  toCanonicalJob: (payload: unknown) => CanonicalJob,
) {
  return (input: { externalId: string; lastKnownPayload: unknown }): NormalizedEvent | null => {
    const { fields } = toCanonicalJob(input.lastKnownPayload);

    return {
      type: JobClosed.name,
      metadata: {
        externalId: fields.externalId,
        title: fields.title,
        absoluteUrl: fields.absoluteUrl,
      },
      occurredAt: new Date(),
      confidence: 1,
      relatedEntityType: "company",
      relatedEntityId: companyId,
    };
  };
}
