import { describe, expect, it } from "vitest";
import { generateId } from "./id";

const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe("generateId", () => {
  it("produces a well-formed UUIDv7", () => {
    expect(generateId()).toMatch(UUID_V7_PATTERN);
  });

  it("produces unique identifiers", () => {
    const ids = new Set(Array.from({ length: 1000 }, () => generateId()));

    expect(ids.size).toBe(1000);
  });

  it("is time-sortable: lexicographic order matches generation order", () => {
    const ids = Array.from({ length: 50 }, () => generateId());
    const sorted = [...ids].sort();

    expect(ids).toEqual(sorted);
  });
});
