import { afterEach, describe, expect, it, vi } from "vitest";
import { assertSafePublicHttpUrl, fetchWithHostValidation, readTextWithLimit } from "./url-safety";

describe("assertSafePublicHttpUrl", () => {
  it("accepts an ordinary public https URL", () => {
    expect(() => assertSafePublicHttpUrl("https://acme.xyz", "test")).not.toThrow();
  });

  it("accepts an ordinary public http URL", () => {
    expect(() => assertSafePublicHttpUrl("http://acme.xyz", "test")).not.toThrow();
  });

  it("rejects a non-http(s) protocol", () => {
    expect(() => assertSafePublicHttpUrl("file:///etc/passwd", "test")).toThrow(/protocol/);
    expect(() => assertSafePublicHttpUrl("ftp://acme.xyz", "test")).toThrow(/protocol/);
  });

  it("rejects a malformed URL", () => {
    expect(() => assertSafePublicHttpUrl("not a url", "test")).toThrow(/not a valid URL/);
  });

  it("rejects localhost", () => {
    expect(() => assertSafePublicHttpUrl("http://localhost:8080", "test")).toThrow(/loopback/);
  });

  it("rejects 127.0.0.1 and other loopback IPv4 addresses", () => {
    expect(() => assertSafePublicHttpUrl("http://127.0.0.1", "test")).toThrow(/private\/reserved/);
    expect(() => assertSafePublicHttpUrl("http://127.1.2.3", "test")).toThrow(/private\/reserved/);
  });

  it("rejects the cloud metadata address", () => {
    expect(() =>
      assertSafePublicHttpUrl("http://169.254.169.254/latest/meta-data", "test"),
    ).toThrow(/private\/reserved/);
  });

  it("rejects private IPv4 ranges (10/8, 172.16/12, 192.168/16)", () => {
    expect(() => assertSafePublicHttpUrl("http://10.0.0.1", "test")).toThrow(/private\/reserved/);
    expect(() => assertSafePublicHttpUrl("http://172.16.0.1", "test")).toThrow(/private\/reserved/);
    expect(() => assertSafePublicHttpUrl("http://192.168.1.1", "test")).toThrow(
      /private\/reserved/,
    );
  });

  it("rejects IPv6 loopback and link-local/unique-local addresses", () => {
    expect(() => assertSafePublicHttpUrl("http://[::1]", "test")).toThrow(/private\/reserved/);
    expect(() => assertSafePublicHttpUrl("http://[fe80::1]", "test")).toThrow(/private\/reserved/);
    expect(() => assertSafePublicHttpUrl("http://[fc00::1]", "test")).toThrow(/private\/reserved/);
  });

  it("rejects .local/.internal/.localhost hostnames", () => {
    expect(() => assertSafePublicHttpUrl("http://printer.local", "test")).toThrow(/reserved host/);
    expect(() => assertSafePublicHttpUrl("http://db.internal", "test")).toThrow(/reserved host/);
  });

  it("does not reject a public IPv4 address that merely looks similar to a private one", () => {
    // 172.15.x.x and 172.32.x.x are outside the 172.16/12 private block.
    expect(() => assertSafePublicHttpUrl("http://172.15.0.1", "test")).not.toThrow();
    expect(() => assertSafePublicHttpUrl("http://172.32.0.1", "test")).not.toThrow();
  });
});

describe("fetchWithHostValidation", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the response directly when there is no redirect", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200 } as Response));

    const response = await fetchWithHostValidation(
      "https://acme.xyz/page",
      { signal: new AbortController().signal },
      "test",
    );

    expect(response.status).toBe(200);
  });

  it("follows a redirect to another public host", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "https://acme.xyz/old") {
        return {
          status: 301,
          headers: new Headers({ location: "https://acme.xyz/new" }),
        } as Response;
      }
      return { ok: true, status: 200 } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await fetchWithHostValidation(
      "https://acme.xyz/old",
      { signal: new AbortController().signal },
      "test",
    );

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("refuses to follow a redirect into a private address", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        status: 302,
        headers: new Headers({ location: "http://169.254.169.254/latest/meta-data" }),
      } as Response),
    );

    await expect(
      fetchWithHostValidation(
        "https://acme.xyz/old",
        { signal: new AbortController().signal },
        "test",
      ),
    ).rejects.toThrow(/private\/reserved/);
  });

  it("gives up after too many redirects rather than looping forever", async () => {
    let hop = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        hop += 1;
        return {
          status: 302,
          headers: new Headers({ location: `https://acme.xyz/hop-${hop}` }),
        } as Response;
      }),
    );

    await expect(
      fetchWithHostValidation(
        "https://acme.xyz/start",
        { signal: new AbortController().signal },
        "test",
      ),
    ).rejects.toThrow(/redirects/);
  });
});

describe("readTextWithLimit", () => {
  function responseWithBody(text: string): Response {
    const encoder = new TextEncoder();
    const bytes = encoder.encode(text);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    });
    return new Response(stream);
  }

  it("returns the full text when under the byte limit", async () => {
    const text = await readTextWithLimit(
      responseWithBody("Contact: mailto:a@acme.xyz"),
      1024,
      "test",
    );
    expect(text).toBe("Contact: mailto:a@acme.xyz");
  });

  it("throws rather than buffering an oversized response", async () => {
    const big = "x".repeat(1000);
    await expect(readTextWithLimit(responseWithBody(big), 100, "test")).rejects.toThrow(
      /exceeded 100-byte limit/,
    );
  });

  it("falls back to response.text() when the body has no reader (e.g. a test mock)", async () => {
    const mockResponse = { text: async () => "fallback text" } as unknown as Response;
    const text = await readTextWithLimit(mockResponse, 1024, "test");
    expect(text).toBe("fallback text");
  });
});
