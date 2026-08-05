import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchLeverPostings } from "./fetch";

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

describe("fetchLeverPostings", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the validated postings array from a well-formed response", async () => {
    mockFetchOnce({
      json: async () => [
        {
          id: "abc",
          text: "Protocol Engineer",
          createdAt: 1_735_689_600_000,
          hostedUrl: "https://jobs.lever.co/example/abc",
        },
      ],
    });

    const postings = await fetchLeverPostings("example-co");

    expect(postings).toHaveLength(1);
    expect(postings[0]?.text).toBe("Protocol Engineer");
  });

  it("preserves fields it doesn't explicitly model (passthrough)", async () => {
    mockFetchOnce({
      json: async () => [
        {
          id: "abc",
          text: "Protocol Engineer",
          createdAt: 1_735_689_600_000,
          hostedUrl: "https://jobs.lever.co/example/abc",
          some_future_field: "value",
        },
      ],
    });

    const postings = await fetchLeverPostings("example-co");

    expect(postings[0]).toMatchObject({ some_future_field: "value" });
  });

  it("throws when the API responds with a non-OK status", async () => {
    mockFetchOnce({ ok: false, status: 404, statusText: "Not Found" });

    await expect(fetchLeverPostings("unknown-co")).rejects.toThrow(/404/);
  });

  it("throws when the response body doesn't match the expected shape", async () => {
    mockFetchOnce({ json: async () => [{ text: "Missing required fields" }] });

    await expect(fetchLeverPostings("example-co")).rejects.toThrow();
  });
});
