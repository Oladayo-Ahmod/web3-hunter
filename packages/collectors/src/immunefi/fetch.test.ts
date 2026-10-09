import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchImmunefiBounties } from "./fetch";

function mockFetchOnce(response: Partial<Response> & { json?: () => Promise<unknown> }) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => [],
      ...response,
    } as Response),
  );
}

function bounty(overrides: Record<string, unknown> = {}) {
  return {
    slug: "enzyme-onyx",
    project: "Enzyme Onyx",
    ecosystem: ["ETH"],
    launchDate: "2025-09-04T10:00:00.000Z",
    updatedDate: "2026-10-09T08:02:03.438Z",
    isPaused: false,
    pausedAt: null,
    maxBounty: 200000,
    rewardsPool: 0,
    githubUrl: "https://github.com/enzymefinance/protocol-onyx",
    websiteUrl: null,
    kyc: false,
    inviteOnly: false,
    assets: [
      {
        id: "cC2hBNCF0nM2dQNqYbgJ0",
        url: "https://github.com/enzymefinance/protocol-onyx/blob/main/src/Foo.sol",
        type: "smart_contract",
        description: "Foo",
      },
    ],
    ...overrides,
  };
}

describe("fetchImmunefiBounties", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the validated bounties array from a well-formed response", async () => {
    mockFetchOnce({ json: async () => [bounty()] });

    const bounties = await fetchImmunefiBounties();

    expect(bounties).toHaveLength(1);
    expect(bounties[0]?.slug).toBe("enzyme-onyx");
  });

  it("preserves fields it doesn't explicitly model (passthrough)", async () => {
    mockFetchOnce({ json: async () => [bounty({ some_future_field: "value" })] });

    const bounties = await fetchImmunefiBounties();

    expect(bounties[0]).toMatchObject({ some_future_field: "value" });
  });

  it("tolerates missing optional fields (githubUrl, websiteUrl, pausedAt, ecosystem, assets)", async () => {
    mockFetchOnce({
      json: async () => [
        bounty({
          githubUrl: undefined,
          websiteUrl: undefined,
          pausedAt: undefined,
          ecosystem: undefined,
          assets: undefined,
        }),
      ],
    });

    const bounties = await fetchImmunefiBounties();

    expect(bounties[0]).toMatchObject({ ecosystem: [], assets: [] });
  });

  it("throws when the API responds with a non-OK status", async () => {
    mockFetchOnce({ ok: false, status: 503, statusText: "Service Unavailable" });

    await expect(fetchImmunefiBounties()).rejects.toThrow(/503/);
  });

  it("throws when a required field is missing (malformed record)", async () => {
    mockFetchOnce({ json: async () => [{ slug: "missing-everything-else" }] });

    await expect(fetchImmunefiBounties()).rejects.toThrow();
  });
});
