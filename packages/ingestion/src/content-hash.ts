import { createHash } from "node:crypto";

/**
 * A stable content hash for a Raw Record's payload, independent of object
 * key ordering — the basis for content-hash deduplication: re-fetching a
 * payload whose meaningful content hasn't changed produces the same hash,
 * so it never becomes a second Raw Record.
 */
export function hashContent(payload: unknown): string {
  return createHash("sha256").update(stableStringify(payload)).digest("hex");
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  const fields = entries.map(
    ([key, fieldValue]) => `${JSON.stringify(key)}:${stableStringify(fieldValue)}`,
  );
  return `{${fields.join(",")}}`;
}
