import { describe, expect, it } from "vitest";
import { JobPosted, JobUpdated } from "../hiring-events";
import { createAshbyJobClosedNormalizer, createAshbyJobNormalizer } from "./normalize";

const COMPANY_ID = "019474b4-9a3e-7c3e-9c3e-9c3e9c3e9c3e";

function job(overrides: Record<string, unknown> = {}) {
  return {
    id: "job-42",
    title: "Solidity Engineer",
    department: "Engineering",
    location: "Remote",
    publishedAt: "2026-01-01T00:00:00.000Z",
    jobUrl: "https://jobs.ashbyhq.com/acme/job-42",
    ...overrides,
  };
}

describe("createAshbyJobNormalizer", () => {
  const normalize = createAshbyJobNormalizer(COMPANY_ID);

  it("produces a JobPosted event when there is no previous payload", () => {
    const result = normalize({
      rawRecordId: "raw-1",
      collectorId: "collector-1",
      payload: job(),
      fetchedAt: new Date(),
      previousPayload: null,
    });

    expect(result?.type).toBe(JobPosted.name);
    expect(result?.relatedEntityType).toBe("company");
    expect(result?.relatedEntityId).toBe(COMPANY_ID);
    expect(result?.metadata).toMatchObject({
      externalId: "job-42",
      title: "Solidity Engineer",
      locationName: "Remote",
      departmentNames: ["Engineering"],
    });
  });

  it("produces null when the previous payload is identical", () => {
    const result = normalize({
      rawRecordId: "raw-2",
      collectorId: "collector-1",
      payload: job(),
      fetchedAt: new Date(),
      previousPayload: job(),
    });

    expect(result).toBeNull();
  });

  it("produces a JobUpdated event citing exactly which fields changed", () => {
    const result = normalize({
      rawRecordId: "raw-3",
      collectorId: "collector-1",
      payload: job({ title: "Senior Solidity Engineer" }),
      fetchedAt: new Date(),
      previousPayload: job(),
    });

    expect(result?.type).toBe(JobUpdated.name);
    expect(result?.metadata).toMatchObject({
      title: "Senior Solidity Engineer",
      changedFrom: { title: "Solidity Engineer" },
    });
  });

  it("falls back to the team field when department is absent", () => {
    const result = normalize({
      rawRecordId: "raw-4",
      collectorId: "collector-1",
      payload: job({ department: null, team: "Platform" }),
      fetchedAt: new Date(),
      previousPayload: null,
    });

    expect(result?.metadata).toMatchObject({ departmentNames: ["Platform"] });
  });

  it("extracts description/employmentType/workplaceType when Ashby provides them", () => {
    const result = normalize({
      rawRecordId: "raw-fields",
      collectorId: "collector-1",
      payload: job({
        descriptionPlain: "We are looking for a Solidity Engineer.",
        employmentType: "FullTime",
        workplaceType: "Hybrid",
      }),
      fetchedAt: new Date(),
      previousPayload: null,
    });

    expect(result?.metadata).toMatchObject({
      description: "We are looking for a Solidity Engineer.",
      employmentType: "full-time",
      workplaceType: "hybrid",
    });
  });

  it("leaves description/employmentType/workplaceType null when Ashby doesn't provide them", () => {
    const result = normalize({
      rawRecordId: "raw-no-fields",
      collectorId: "collector-1",
      payload: job(),
      fetchedAt: new Date(),
      previousPayload: null,
    });

    expect(result?.metadata).toMatchObject({
      description: null,
      employmentType: null,
      workplaceType: null,
    });
  });

  // Regression: a real Ashby board (op-labs) sends explicit `null` for
  // `workplaceType` on some postings, not just an absent key — the schema
  // must accept that, not throw. See job-field-normalization's callers.
  it("does not throw when Ashby sends an explicit null for these fields", () => {
    const result = normalize({
      rawRecordId: "raw-explicit-null",
      collectorId: "collector-1",
      payload: job({ workplaceType: null, employmentType: null, descriptionPlain: null }),
      fetchedAt: new Date(),
      previousPayload: null,
    });

    expect(result?.metadata).toMatchObject({
      description: null,
      employmentType: null,
      workplaceType: null,
    });
  });

  it("prefers the updatedAt timestamp over publishedAt when present", () => {
    const result = normalize({
      rawRecordId: "raw-5",
      collectorId: "collector-1",
      payload: job({ updatedAt: "2026-02-01T00:00:00.000Z" }),
      fetchedAt: new Date(),
      previousPayload: null,
    });

    expect(result?.occurredAt).toEqual(new Date("2026-02-01T00:00:00.000Z"));
  });
});

describe("createAshbyJobClosedNormalizer", () => {
  it("produces a JobClosed event from the last known payload", () => {
    const normalize = createAshbyJobClosedNormalizer(COMPANY_ID);

    const result = normalize({ externalId: "job-42", lastKnownPayload: job() });

    expect(result?.metadata).toEqual({
      externalId: "job-42",
      title: "Solidity Engineer",
      absoluteUrl: "https://jobs.ashbyhq.com/acme/job-42",
    });
    expect(result?.relatedEntityId).toBe(COMPANY_ID);
  });
});
