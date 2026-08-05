import { describe, expect, it } from "vitest";
import { RepositoryDiscovered, RepositoryUpdated } from "../repository-events";
import { createGithubRepositoryNormalizer } from "./normalize";

const COMPANY_ID = "019474b4-9a3e-7c3e-9c3e-9c3e9c3e9c3e";

function repo(overrides: Record<string, unknown> = {}) {
  return {
    id: 42,
    name: "protocol-node",
    full_name: "acme/protocol-node",
    html_url: "https://github.com/acme/protocol-node",
    description: "The Acme protocol node",
    language: "Rust",
    topics: ["zero-knowledge"],
    archived: false,
    fork: false,
    license: { key: "mit" },
    stargazers_count: 100,
    pushed_at: "2026-01-01T00:00:00-00:00",
    updated_at: "2026-01-01T00:00:00-00:00",
    ...overrides,
  };
}

describe("createGithubRepositoryNormalizer", () => {
  const normalize = createGithubRepositoryNormalizer(COMPANY_ID);

  it("produces a RepositoryDiscovered event when there is no previous payload", () => {
    const result = normalize({
      rawRecordId: "raw-1",
      collectorId: "collector-1",
      payload: repo(),
      fetchedAt: new Date(),
      previousPayload: null,
    });

    expect(result?.type).toBe(RepositoryDiscovered.name);
    expect(result?.relatedEntityType).toBe("company");
    expect(result?.relatedEntityId).toBe(COMPANY_ID);
    expect(result?.metadata).toMatchObject({
      externalId: "42",
      name: "protocol-node",
      language: "Rust",
      topics: ["zero-knowledge"],
      licenseKey: "mit",
    });
  });

  it("produces null when the previous payload is identical", () => {
    const result = normalize({
      rawRecordId: "raw-2",
      collectorId: "collector-1",
      payload: repo(),
      fetchedAt: new Date(),
      previousPayload: repo(),
    });

    expect(result).toBeNull();
  });

  it("produces a RepositoryUpdated event citing exactly which fields changed", () => {
    const result = normalize({
      rawRecordId: "raw-3",
      collectorId: "collector-1",
      payload: repo({ archived: true }),
      fetchedAt: new Date(),
      previousPayload: repo(),
    });

    expect(result?.type).toBe(RepositoryUpdated.name);
    expect(result?.metadata).toMatchObject({
      archived: true,
      changedFrom: { archived: false },
    });
  });

  it("does not report unrelated fields as changed", () => {
    const result = normalize({
      rawRecordId: "raw-4",
      collectorId: "collector-1",
      payload: repo({ stargazers_count: 200 }),
      fetchedAt: new Date(),
      previousPayload: repo(),
    });

    const changedFrom = (result?.metadata as { changedFrom: Record<string, unknown> }).changedFrom;
    expect(Object.keys(changedFrom)).toEqual(["stargazersCount"]);
  });

  it("maps a missing license to null", () => {
    const result = normalize({
      rawRecordId: "raw-5",
      collectorId: "collector-1",
      payload: repo({ license: null }),
      fetchedAt: new Date(),
      previousPayload: null,
    });

    expect(result?.metadata).toMatchObject({ licenseKey: null });
  });
});
