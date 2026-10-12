import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetGithubCollectorEnvCache } from "../github/env";
import { fetchGithubSecurityPolicy, parseGithubRepoUrl } from "./github-security-policy";

describe("parseGithubRepoUrl", () => {
  it("extracts owner/repo from a plain repository URL", () => {
    expect(parseGithubRepoUrl("https://github.com/acme/contracts")).toEqual({
      owner: "acme",
      repo: "contracts",
    });
  });

  it("strips a trailing slash", () => {
    expect(parseGithubRepoUrl("https://github.com/acme/contracts/")).toEqual({
      owner: "acme",
      repo: "contracts",
    });
  });

  it("strips a trailing .git suffix", () => {
    expect(parseGithubRepoUrl("https://github.com/acme/contracts.git")).toEqual({
      owner: "acme",
      repo: "contracts",
    });
  });

  it("returns null for an organization URL with no repository segment", () => {
    expect(parseGithubRepoUrl("https://github.com/acme")).toBeNull();
  });

  it("returns null for a non-GitHub URL", () => {
    expect(parseGithubRepoUrl("https://gitlab.com/acme/contracts")).toBeNull();
  });

  it("returns null for a malformed URL", () => {
    expect(parseGithubRepoUrl("not a url")).toBeNull();
  });
});

describe("fetchGithubSecurityPolicy", () => {
  beforeEach(() => {
    resetGithubCollectorEnvCache();
    delete process.env.GITHUB_TOKEN;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetGithubCollectorEnvCache();
  });

  it("reports found: true with the policy's html_url when the community profile lists one", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          files: {
            security_policy: {
              html_url: "https://github.com/acme/contracts/blob/main/SECURITY.md",
            },
          },
        }),
      } as Response),
    );

    const result = await fetchGithubSecurityPolicy("acme", "contracts");

    expect(result).toEqual({
      found: true,
      sourceUrl: "https://api.github.com/repos/acme/contracts/community/profile",
      policyUrl: "https://github.com/acme/contracts/blob/main/SECURITY.md",
    });
  });

  it("reports found: false when the community profile has no security policy", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ files: { security_policy: null } }),
      } as Response),
    );

    const result = await fetchGithubSecurityPolicy("acme", "contracts");

    expect(result.found).toBe(false);
    expect(result.policyUrl).toBeNull();
  });

  it("throws on a non-OK response, including 404 — a missing repo is never conflated with 'no policy'", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 404, statusText: "Not Found" } as Response),
    );

    await expect(fetchGithubSecurityPolicy("acme", "unknown")).rejects.toThrow(/404/);
  });

  it("sends a bearer Authorization header when GITHUB_TOKEN is configured", async () => {
    process.env.GITHUB_TOKEN = "test-token";
    resetGithubCollectorEnvCache();

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ files: {} }),
    } as Response);
    vi.stubGlobal("fetch", fetchMock);

    await fetchGithubSecurityPolicy("acme", "contracts");

    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer test-token");
  });
});
