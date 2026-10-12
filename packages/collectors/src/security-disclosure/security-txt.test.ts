import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchSecurityTxt, parseSecurityTxt } from "./security-txt";

describe("parseSecurityTxt", () => {
  it("extracts Contact, Policy, Canonical, and Expires fields", () => {
    const text = [
      "Contact: mailto:security@acme.xyz",
      "Policy: https://acme.xyz/security-policy",
      "Canonical: https://acme.xyz/.well-known/security.txt",
      "Expires: 2027-01-01T00:00:00.000Z",
    ].join("\n");

    expect(parseSecurityTxt(text)).toEqual({
      contacts: ["mailto:security@acme.xyz"],
      policyUrl: "https://acme.xyz/security-policy",
      canonicalUrl: "https://acme.xyz/.well-known/security.txt",
      expires: "2027-01-01T00:00:00.000Z",
    });
  });

  it("preserves multiple Contact lines in their original, source-given order", () => {
    const text = ["Contact: mailto:security@acme.xyz", "Contact: https://acme.xyz/report"].join(
      "\n",
    );

    expect(parseSecurityTxt(text).contacts).toEqual([
      "mailto:security@acme.xyz",
      "https://acme.xyz/report",
    ]);
  });

  it("ignores comments and blank lines", () => {
    const text = ["# This is a comment", "", "Contact: mailto:security@acme.xyz", ""].join("\n");

    expect(parseSecurityTxt(text).contacts).toEqual(["mailto:security@acme.xyz"]);
  });

  it("ignores unrecognized fields without error, per RFC 9116's forward-compatibility guidance", () => {
    const text = [
      "Contact: mailto:security@acme.xyz",
      "Hiring: https://acme.xyz/careers",
      "Preferred-Languages: en",
    ].join("\n");

    const result = parseSecurityTxt(text);
    expect(result.contacts).toEqual(["mailto:security@acme.xyz"]);
    expect(result.policyUrl).toBeNull();
  });

  it("keeps the first Policy/Canonical/Expires value when a non-conformant file repeats them", () => {
    const text = ["Policy: https://acme.xyz/first", "Policy: https://acme.xyz/second"].join("\n");

    expect(parseSecurityTxt(text).policyUrl).toBe("https://acme.xyz/first");
  });

  it("returns an all-empty result for text with no recognized fields", () => {
    expect(parseSecurityTxt("")).toEqual({
      contacts: [],
      policyUrl: null,
      canonicalUrl: null,
      expires: null,
    });
  });
});

describe("fetchSecurityTxt", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches the RFC 9116 well-known location for the website's own origin", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => "Contact: mailto:security@acme.xyz",
    } as Response);
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchSecurityTxt("https://acme.xyz/some/page");

    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://acme.xyz/.well-known/security.txt");
    expect(result).toEqual({
      found: true,
      sourceUrl: "https://acme.xyz/.well-known/security.txt",
      contacts: ["mailto:security@acme.xyz"],
      policyUrl: null,
      canonicalUrl: null,
      expires: null,
    });
  });

  it("treats a 404 as a legitimate 'not found' result, not a failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 404, statusText: "Not Found" } as Response),
    );

    const result = await fetchSecurityTxt("https://acme.xyz");

    expect(result.found).toBe(false);
    expect(result.contacts).toEqual([]);
  });

  it("throws, never silently returning 'not found', on a non-404 error status", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue({
          ok: false,
          status: 503,
          statusText: "Service Unavailable",
        } as Response),
    );

    await expect(fetchSecurityTxt("https://acme.xyz")).rejects.toThrow(/503/);
  });

  it("throws, never silently returning 'not found', on a network failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("getaddrinfo ENOTFOUND")));

    await expect(fetchSecurityTxt("https://acme.xyz")).rejects.toThrow(/ENOTFOUND/);
  });
});
