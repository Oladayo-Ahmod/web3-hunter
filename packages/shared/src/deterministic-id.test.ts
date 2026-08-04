import { describe, expect, it } from "vitest";
import { deriveDeterministicId } from "./deterministic-id";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe("deriveDeterministicId", () => {
  it("produces a well-formed UUID", () => {
    expect(deriveDeterministicId("example-seed")).toMatch(UUID_PATTERN);
  });

  it("is deterministic: the same seed always produces the same ID", () => {
    expect(deriveDeterministicId("same-seed")).toBe(deriveDeterministicId("same-seed"));
  });

  it("produces different IDs for different seeds", () => {
    expect(deriveDeterministicId("seed-a")).not.toBe(deriveDeterministicId("seed-b"));
  });

  it("is sensitive to namespacing, so different concepts never collide on the same raw key", () => {
    expect(deriveDeterministicId("package-a:concept:123")).not.toBe(
      deriveDeterministicId("package-b:concept:123"),
    );
  });
});
