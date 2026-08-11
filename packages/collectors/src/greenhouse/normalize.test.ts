import { describe, expect, it } from "vitest";
import { JobPosted, JobUpdated } from "../hiring-events";
import { createGreenhouseJobClosedNormalizer, createGreenhouseJobNormalizer } from "./normalize";

const COMPANY_ID = "019474b4-9a3e-7c3e-9c3e-9c3e9c3e9c3e";

function job(overrides: Record<string, unknown> = {}) {
  return {
    id: 42,
    title: "Solidity Engineer",
    updated_at: "2026-01-01T00:00:00-00:00",
    absolute_url: "https://example.com/jobs/42",
    location: { name: "Remote" },
    departments: [{ name: "Engineering" }],
    ...overrides,
  };
}

describe("createGreenhouseJobNormalizer", () => {
  const normalize = createGreenhouseJobNormalizer(COMPANY_ID);

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
      externalId: "42",
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

  it("extracts a plain-text description from HTML-encoded content, and leaves employment/workplace type null (Greenhouse has neither field)", () => {
    const result = normalize({
      rawRecordId: "raw-content",
      collectorId: "collector-1",
      payload: job({ content: "&lt;p&gt;About the role&lt;/p&gt;" }),
      fetchedAt: new Date(),
      previousPayload: null,
    });

    expect(result?.metadata).toMatchObject({
      description: "About the role",
      employmentType: null,
      workplaceType: null,
    });
  });

  it("produces a null description when the source has no content field", () => {
    const result = normalize({
      rawRecordId: "raw-no-content",
      collectorId: "collector-1",
      payload: job(),
      fetchedAt: new Date(),
      previousPayload: null,
    });

    expect(result?.metadata).toMatchObject({ description: null });
  });

  it("does not report unrelated fields as changed", () => {
    const result = normalize({
      rawRecordId: "raw-4",
      collectorId: "collector-1",
      payload: job({ location: { name: "New York" } }),
      fetchedAt: new Date(),
      previousPayload: job(),
    });

    const changedFrom = (result?.metadata as { changedFrom: Record<string, unknown> }).changedFrom;
    expect(Object.keys(changedFrom)).toEqual(["locationName"]);
  });
});

describe("createGreenhouseJobClosedNormalizer", () => {
  it("produces a JobClosed event from the last known payload", () => {
    const normalize = createGreenhouseJobClosedNormalizer(COMPANY_ID);

    const result = normalize({ externalId: "42", lastKnownPayload: job() });

    expect(result?.metadata).toEqual({
      externalId: "42",
      title: "Solidity Engineer",
      absoluteUrl: "https://example.com/jobs/42",
    });
    expect(result?.relatedEntityId).toBe(COMPANY_ID);
  });
});
