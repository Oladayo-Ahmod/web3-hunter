import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchDefiLlamaProtocols } from "./fetch";

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

function protocol(overrides: Record<string, unknown> = {}) {
  return {
    name: "Aave",
    slug: "aave",
    category: "Lending",
    tvl: 17_340_296_990.6,
    change_1d: -1.83,
    change_7d: -4.39,
    listedAt: 1_648_776_877,
    audits: "2",
    audit_links: ["https://aave.com/security"],
    chains: ["Ethereum", "Arbitrum"],
    ...overrides,
  };
}

describe("fetchDefiLlamaProtocols", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the validated protocols array from a well-formed response", async () => {
    mockFetchOnce({ json: async () => [protocol()] });

    const protocols = await fetchDefiLlamaProtocols();

    expect(protocols).toHaveLength(1);
    expect(protocols[0]?.slug).toBe("aave");
  });

  it("preserves fields it doesn't explicitly model (passthrough)", async () => {
    mockFetchOnce({ json: async () => [protocol({ some_future_field: "value" })] });

    const protocols = await fetchDefiLlamaProtocols();

    expect(protocols[0]).toMatchObject({ some_future_field: "value" });
  });

  it("tolerates a protocol with no audits, audit_links, or tvl reported", async () => {
    mockFetchOnce({
      json: async () => [
        protocol({
          audits: undefined,
          audit_links: undefined,
          tvl: undefined,
          listedAt: undefined,
        }),
      ],
    });

    const protocols = await fetchDefiLlamaProtocols();

    expect(protocols[0]).toMatchObject({ audits: undefined, tvl: undefined });
  });

  it("throws when the API responds with a non-OK status", async () => {
    mockFetchOnce({ ok: false, status: 503, statusText: "Service Unavailable" });

    await expect(fetchDefiLlamaProtocols()).rejects.toThrow(/503/);
  });

  it("throws when the response body doesn't match the expected shape", async () => {
    mockFetchOnce({ json: async () => [{ name: "Missing slug" }] });

    await expect(fetchDefiLlamaProtocols()).rejects.toThrow();
  });
});
