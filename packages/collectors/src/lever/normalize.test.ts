import { describe, expect, it } from "vitest";
import { JobPosted, JobUpdated } from "../hiring-events";
import { createLeverJobClosedNormalizer, createLeverJobNormalizer } from "./normalize";

const COMPANY_ID = "019474b4-9a3e-7c3e-9c3e-9c3e9c3e9c3e";

function posting(overrides: Record<string, unknown> = {}) {
  return {
    id: "251d8ee5-abcd-ef01-2345-6789abcdef01",
    text: "Solidity Engineer",
    createdAt: 1_735_689_600_000,
    hostedUrl: "https://jobs.lever.co/acme/251d8ee5",
    categories: { department: "Engineering", location: "Remote" },
    ...overrides,
  };
}

describe("createLeverJobNormalizer", () => {
  const normalize = createLeverJobNormalizer(COMPANY_ID);

  it("produces a JobPosted event when there is no previous payload", () => {
    const result = normalize({
      rawRecordId: "raw-1",
      collectorId: "collector-1",
      payload: posting(),
      fetchedAt: new Date(),
      previousPayload: null,
    });

    expect(result?.type).toBe(JobPosted.name);
    expect(result?.relatedEntityType).toBe("company");
    expect(result?.relatedEntityId).toBe(COMPANY_ID);
    expect(result?.metadata).toMatchObject({
      externalId: "251d8ee5-abcd-ef01-2345-6789abcdef01",
      title: "Solidity Engineer",
      locationName: "Remote",
      departmentNames: ["Engineering"],
    });
  });

  it("produces null when the previous payload is identical", () => {
    const result = normalize({
      rawRecordId: "raw-2",
      collectorId: "collector-1",
      payload: posting(),
      fetchedAt: new Date(),
      previousPayload: posting(),
    });

    expect(result).toBeNull();
  });

  it("produces a JobUpdated event citing exactly which fields changed", () => {
    const result = normalize({
      rawRecordId: "raw-3",
      collectorId: "collector-1",
      payload: posting({ text: "Senior Solidity Engineer" }),
      fetchedAt: new Date(),
      previousPayload: posting(),
    });

    expect(result?.type).toBe(JobUpdated.name);
    expect(result?.metadata).toMatchObject({
      title: "Senior Solidity Engineer",
      changedFrom: { title: "Solidity Engineer" },
    });
  });

  it("falls back to the team category when department is absent", () => {
    const result = normalize({
      rawRecordId: "raw-4",
      collectorId: "collector-1",
      payload: posting({ categories: { team: "Platform" } }),
      fetchedAt: new Date(),
      previousPayload: null,
    });

    expect(result?.metadata).toMatchObject({ departmentNames: ["Platform"] });
  });

  it("extracts description/employmentType/workplaceType when Lever provides them", () => {
    const result = normalize({
      rawRecordId: "raw-fields",
      collectorId: "collector-1",
      payload: posting({
        descriptionPlain: "We are looking for a Solidity Engineer.",
        categories: { department: "Engineering", commitment: "Full-time" },
        workplaceType: "remote",
      }),
      fetchedAt: new Date(),
      previousPayload: null,
    });

    expect(result?.metadata).toMatchObject({
      description: "We are looking for a Solidity Engineer.",
      employmentType: "full-time",
      workplaceType: "remote",
    });
  });

  it("leaves description/employmentType/workplaceType null when Lever doesn't provide them", () => {
    const result = normalize({
      rawRecordId: "raw-no-fields",
      collectorId: "collector-1",
      payload: posting(),
      fetchedAt: new Date(),
      previousPayload: null,
    });

    expect(result?.metadata).toMatchObject({
      description: null,
      employmentType: null,
      workplaceType: null,
    });
  });

  it("prefers the updatedAt timestamp over createdAt when present", () => {
    const result = normalize({
      rawRecordId: "raw-5",
      collectorId: "collector-1",
      payload: posting({ updatedAt: 1_735_776_000_000 }),
      fetchedAt: new Date(),
      previousPayload: null,
    });

    expect(result?.occurredAt).toEqual(new Date(1_735_776_000_000));
  });
});

describe("createLeverJobClosedNormalizer", () => {
  it("produces a JobClosed event from the last known payload", () => {
    const normalize = createLeverJobClosedNormalizer(COMPANY_ID);

    const result = normalize({
      externalId: "251d8ee5-abcd-ef01-2345-6789abcdef01",
      lastKnownPayload: posting(),
    });

    expect(result?.metadata).toEqual({
      externalId: "251d8ee5-abcd-ef01-2345-6789abcdef01",
      title: "Solidity Engineer",
      absoluteUrl: "https://jobs.lever.co/acme/251d8ee5",
    });
    expect(result?.relatedEntityId).toBe(COMPANY_ID);
  });
});
