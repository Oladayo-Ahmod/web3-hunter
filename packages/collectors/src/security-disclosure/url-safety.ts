/**
 * SSRF defenses shared by every fetch this Collector makes against a
 * stored, source-supplied URL (a target's own `websiteUrl`) — never
 * fully trusted, since it originates from a third-party ingestion
 * payload (DefiLlama/Immunefi), not a value this system itself
 * generated. GitHub's own API calls are not routed through this: their
 * host (`api.github.com`) is a fixed literal this code writes, never
 * derived from source data, so there is no host to validate there —
 * only the path segments (`owner`/`repo`), which `github-security-policy.ts`
 * sanitizes separately.
 */

const BLOCKED_HOSTNAME_SUFFIXES = [".local", ".internal", ".localhost"];

function isPrivateOrReservedIPv4(hostname: string): boolean {
  const parts = hostname.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part) || part < 0 || part > 255)) {
    return false;
  }
  const [a, b] = parts as [number, number, number, number];
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 169 && b === 254) return true; // link-local, incl. cloud metadata (169.254.169.254)
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // shared/CGNAT address space
  return false;
}

function isPrivateOrReservedIPv6(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === "::1" || h === "::") return true;
  if (h.startsWith("fe80:") || h.startsWith("fc") || h.startsWith("fd")) return true;
  if (h.startsWith("::ffff:")) {
    return isPrivateOrReservedIPv4(h.slice("::ffff:".length));
  }
  return false;
}

/**
 * Throws unless `rawUrl` is a plain `http(s)` URL to a public hostname —
 * never a loopback/private/link-local/reserved address or a `.local`/
 * `.internal`/`.localhost` name. This is a literal pattern check, not a
 * DNS-resolution check (no lookup is performed, so a hostname that
 * later resolves to a private address via DNS rebinding is not caught
 * here) — a bounded, dependency-free mitigation appropriate for
 * already-vetted protocol website URLs, not a substitute for network-
 * level egress controls.
 */
export function assertSafePublicHttpUrl(rawUrl: string, context: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`${context}: not a valid URL ("${rawUrl}")`);
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`${context}: unsupported protocol "${url.protocol}" for "${rawUrl}"`);
  }

  const hostname = url.hostname.toLowerCase();
  if (!hostname || hostname === "localhost") {
    throw new Error(`${context}: refusing to fetch loopback/empty host ("${rawUrl}")`);
  }
  if (BLOCKED_HOSTNAME_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) {
    throw new Error(`${context}: refusing to fetch reserved host "${hostname}"`);
  }

  const bareHostname =
    hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;

  if (/^\d+\.\d+\.\d+\.\d+$/.test(bareHostname) && isPrivateOrReservedIPv4(bareHostname)) {
    throw new Error(
      `${context}: refusing to fetch private/reserved IPv4 address "${bareHostname}"`,
    );
  }
  if (bareHostname.includes(":") && isPrivateOrReservedIPv6(bareHostname)) {
    throw new Error(
      `${context}: refusing to fetch private/reserved IPv6 address "${bareHostname}"`,
    );
  }

  return url;
}

const MAX_REDIRECTS = 3;

/**
 * `fetch` with manual redirect handling, re-validating every hop against
 * `assertSafePublicHttpUrl` — the defense `redirect: "follow"` alone
 * cannot provide, since a response from an already-validated host can
 * still redirect to an internal address. Bounded to `MAX_REDIRECTS` hops
 * so a redirect loop can't hang a check indefinitely.
 */
export async function fetchWithHostValidation(
  initialUrl: string,
  init: { signal: AbortSignal; headers?: Record<string, string> },
  context: string,
): Promise<Response> {
  let currentUrl = initialUrl;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    assertSafePublicHttpUrl(currentUrl, context);
    const response = await fetch(currentUrl, { ...init, redirect: "manual" });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) {
        return response;
      }
      currentUrl = new URL(location, currentUrl).toString();
      continue;
    }

    return response;
  }

  throw new Error(`${context}: exceeded ${MAX_REDIRECTS} redirects fetching "${initialUrl}"`);
}

/**
 * Reads a response body as UTF-8 text, aborting once `maxBytes` is
 * exceeded — bounds memory use against an unexpectedly large or
 * malicious response. `security.txt`/GitHub's Community Profile JSON
 * are both expected to be a few KB at most.
 */
export async function readTextWithLimit(
  response: Response,
  maxBytes: number,
  context: string,
): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) {
    return await response.text();
  }

  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    if (value) {
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error(`${context}: response exceeded ${maxBytes}-byte limit`);
      }
      chunks.push(value);
    }
  }

  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf-8");
}
