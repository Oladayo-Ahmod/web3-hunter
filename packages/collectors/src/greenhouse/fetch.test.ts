import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchGreenhouseJobs } from "./fetch";

function mockFetchOnce(response: Partial<Response> & { json?: () => Promise<unknown> }) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({}),
      ...response,
    } as Response),
  );
}

describe("fetchGreenhouseJobs", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the validated jobs array from a well-formed response", async () => {
    mockFetchOnce({
      json: async () => ({
        jobs: [
          {
            id: 1,
            title: "Protocol Engineer",
            updated_at: "2026-01-01T00:00:00-00:00",
            absolute_url: "https://example.com/1",
          },
        ],
      }),
    });

    const jobs = await fetchGreenhouseJobs("example-co");

    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.title).toBe("Protocol Engineer");
  });

  it("preserves fields it doesn't explicitly model (passthrough)", async () => {
    mockFetchOnce({
      json: async () => ({
        jobs: [
          {
            id: 1,
            title: "Protocol Engineer",
            updated_at: "2026-01-01T00:00:00-00:00",
            absolute_url: "https://example.com/1",
            some_future_field: "value",
          },
        ],
      }),
    });

    const jobs = await fetchGreenhouseJobs("example-co");

    expect(jobs[0]).toMatchObject({ some_future_field: "value" });
  });

  it("throws when the API responds with a non-OK status", async () => {
    mockFetchOnce({ ok: false, status: 404, statusText: "Not Found" });

    await expect(fetchGreenhouseJobs("unknown-co")).rejects.toThrow(/404/);
  });

  it("throws when the response body doesn't match the expected shape", async () => {
    mockFetchOnce({ json: async () => ({ jobs: [{ title: "Missing required fields" }] }) });

    await expect(fetchGreenhouseJobs("example-co")).rejects.toThrow();
  });
});
