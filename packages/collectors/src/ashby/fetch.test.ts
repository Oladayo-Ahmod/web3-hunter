import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchAshbyJobs } from "./fetch";

function mockFetchOnce(response: Partial<Response> & { json?: () => Promise<unknown> }) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({ jobs: [] }),
      ...response,
    } as Response),
  );
}

describe("fetchAshbyJobs", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the validated jobs array from a well-formed response", async () => {
    mockFetchOnce({
      json: async () => ({
        jobs: [
          {
            id: "1",
            title: "Protocol Engineer",
            publishedAt: "2026-01-01T00:00:00.000Z",
            jobUrl: "https://jobs.ashbyhq.com/example/1",
          },
        ],
      }),
    });

    const jobs = await fetchAshbyJobs("example-co");

    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.title).toBe("Protocol Engineer");
  });

  it("preserves fields it doesn't explicitly model (passthrough)", async () => {
    mockFetchOnce({
      json: async () => ({
        jobs: [
          {
            id: "1",
            title: "Protocol Engineer",
            publishedAt: "2026-01-01T00:00:00.000Z",
            jobUrl: "https://jobs.ashbyhq.com/example/1",
            some_future_field: "value",
          },
        ],
      }),
    });

    const jobs = await fetchAshbyJobs("example-co");

    expect(jobs[0]).toMatchObject({ some_future_field: "value" });
  });

  it("throws when the API responds with a non-OK status", async () => {
    mockFetchOnce({ ok: false, status: 404, statusText: "Not Found" });

    await expect(fetchAshbyJobs("unknown-co")).rejects.toThrow(/404/);
  });

  it("throws when the response body doesn't match the expected shape", async () => {
    mockFetchOnce({ json: async () => ({ jobs: [{ title: "Missing required fields" }] }) });

    await expect(fetchAshbyJobs("example-co")).rejects.toThrow();
  });
});
