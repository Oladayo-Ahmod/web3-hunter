import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetGithubCollectorEnvCache } from "./env";
import { fetchGithubOrgRepos } from "./fetch";

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

function repo(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    name: "example-repo",
    full_name: "example-org/example-repo",
    html_url: "https://github.com/example-org/example-repo",
    description: null,
    language: "Rust",
    topics: ["zero-knowledge"],
    archived: false,
    fork: false,
    license: { key: "mit" },
    stargazers_count: 10,
    pushed_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("fetchGithubOrgRepos", () => {
  beforeEach(() => {
    resetGithubCollectorEnvCache();
    delete process.env.GITHUB_TOKEN;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetGithubCollectorEnvCache();
  });

  it("returns the validated repos array from a well-formed response", async () => {
    mockFetchOnce({ json: async () => [repo()] });

    const repos = await fetchGithubOrgRepos("example-org");

    expect(repos).toHaveLength(1);
    expect(repos[0]?.name).toBe("example-repo");
  });

  it("preserves fields it doesn't explicitly model (passthrough)", async () => {
    mockFetchOnce({ json: async () => [repo({ some_future_field: "value" })] });

    const repos = await fetchGithubOrgRepos("example-org");

    expect(repos[0]).toMatchObject({ some_future_field: "value" });
  });

  it("sends no Authorization header when GITHUB_TOKEN is unset", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => [],
    } as Response);
    vi.stubGlobal("fetch", fetchMock);

    await fetchGithubOrgRepos("example-org");

    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
  });

  it("sends a bearer Authorization header when GITHUB_TOKEN is configured", async () => {
    process.env.GITHUB_TOKEN = "test-token";
    resetGithubCollectorEnvCache();

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => [],
    } as Response);
    vi.stubGlobal("fetch", fetchMock);

    await fetchGithubOrgRepos("example-org");

    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer test-token");
  });

  it("throws when the API responds with a non-OK status", async () => {
    mockFetchOnce({ ok: false, status: 404, statusText: "Not Found" });

    await expect(fetchGithubOrgRepos("unknown-org")).rejects.toThrow(/404/);
  });

  it("throws when the response body doesn't match the expected shape", async () => {
    mockFetchOnce({ json: async () => [{ name: "Missing required fields" }] });

    await expect(fetchGithubOrgRepos("example-org")).rejects.toThrow();
  });
});
