import { describe, expect, it } from "vitest";
import { ProtocolSnapshotRecorded, ProtocolSnapshotUpdated } from "../protocol-events";
import {
  createDefiLlamaProtocolNormalizer,
  deriveRepositoryUrlFromDefiLlamaPayload,
} from "./normalize";

const SECURITY_TARGET_ID = "019474b4-9a3e-7c3e-9c3e-9c3e9c3e9c3e";

function protocol(overrides: Record<string, unknown> = {}) {
  return {
    name: "Aave",
    slug: "aave",
    category: "Lending",
    tvl: 17_000_000_000,
    change_1d: -1.83,
    change_7d: -4.39,
    listedAt: 1_648_776_877,
    audits: "2",
    audit_links: ["https://aave.com/security"],
    chains: ["Ethereum"],
    ...overrides,
  };
}

describe("createDefiLlamaProtocolNormalizer", () => {
  const normalize = createDefiLlamaProtocolNormalizer(SECURITY_TARGET_ID);
  const fetchedAt = new Date("2026-03-01T00:00:00Z");

  it("produces a ProtocolSnapshotRecorded event when there is no previous payload", () => {
    const result = normalize({
      rawRecordId: "raw-1",
      collectorId: "collector-1",
      payload: protocol(),
      fetchedAt,
      previousPayload: null,
    });

    expect(result?.type).toBe(ProtocolSnapshotRecorded.name);
    expect(result?.relatedEntityType).toBe("security_target");
    expect(result?.relatedEntityId).toBe(SECURITY_TARGET_ID);
    expect(result?.occurredAt).toEqual(fetchedAt);
    expect(result?.metadata).toMatchObject({
      slug: "aave",
      name: "Aave",
      tvl: 17_000_000_000,
      audits: "2",
      auditLinks: ["https://aave.com/security"],
    });
  });

  it("produces null when the previous payload is identical", () => {
    const result = normalize({
      rawRecordId: "raw-2",
      collectorId: "collector-1",
      payload: protocol(),
      fetchedAt,
      previousPayload: protocol(),
    });

    expect(result).toBeNull();
  });

  it("produces a ProtocolSnapshotUpdated event citing exactly which fields changed", () => {
    const result = normalize({
      rawRecordId: "raw-3",
      collectorId: "collector-1",
      payload: protocol({ tvl: 20_000_000_000 }),
      fetchedAt,
      previousPayload: protocol(),
    });

    expect(result?.type).toBe(ProtocolSnapshotUpdated.name);
    expect(result?.metadata).toMatchObject({
      tvl: 20_000_000_000,
      changedFrom: { tvl: 17_000_000_000 },
    });
  });

  it("does not report unrelated fields as changed", () => {
    const result = normalize({
      rawRecordId: "raw-4",
      collectorId: "collector-1",
      payload: protocol({ change_1d: 5 }),
      fetchedAt,
      previousPayload: protocol(),
    });

    const changedFrom = (result?.metadata as { changedFrom: Record<string, unknown> }).changedFrom;
    expect(Object.keys(changedFrom)).toEqual(["change1d"]);
  });

  it("maps missing audits/audit_links/listedAt to null/empty rather than undefined", () => {
    const result = normalize({
      rawRecordId: "raw-5",
      collectorId: "collector-1",
      payload: protocol({ audits: undefined, audit_links: undefined, listedAt: undefined }),
      fetchedAt,
      previousPayload: null,
    });

    expect(result?.metadata).toMatchObject({ audits: null, auditLinks: [], listedAt: null });
  });
});

describe("deriveRepositoryUrlFromDefiLlamaPayload", () => {
  it("derives a GitHub organization URL from the first github entry", () => {
    const url = deriveRepositoryUrlFromDefiLlamaPayload(protocol({ github: ["0xTwyne"] }));
    expect(url).toBe("https://github.com/0xTwyne");
  });

  it("returns null when github is absent", () => {
    expect(deriveRepositoryUrlFromDefiLlamaPayload(protocol())).toBeNull();
  });

  it("returns null when github is an empty array", () => {
    expect(deriveRepositoryUrlFromDefiLlamaPayload(protocol({ github: [] }))).toBeNull();
  });

  it("returns null for a malformed/unparseable payload rather than throwing", () => {
    expect(deriveRepositoryUrlFromDefiLlamaPayload({ not: "a protocol" })).toBeNull();
    expect(deriveRepositoryUrlFromDefiLlamaPayload(null)).toBeNull();
    expect(deriveRepositoryUrlFromDefiLlamaPayload("not even an object")).toBeNull();
  });
});
