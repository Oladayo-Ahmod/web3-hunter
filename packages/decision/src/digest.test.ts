import { describe, expect, it } from "vitest";
import { MAX_DIGEST_CANDIDATES } from "./constants";
import { selectDigestCandidates, type DigestCandidateInput } from "./digest";

function recommendation(
  id: string,
  status: DigestCandidateInput["status"],
  priority: number,
): DigestCandidateInput {
  return { id, status, priority };
}

describe("selectDigestCandidates", () => {
  it("excludes non-active Recommendations", () => {
    const candidates = selectDigestCandidates([
      recommendation("a", "active", 0.9),
      recommendation("b", "dismissed", 0.95),
      recommendation("c", "archived", 0.99),
      recommendation("d", "expired", 0.99),
    ]);
    expect(candidates.map((c) => c.id)).toEqual(["a"]);
  });

  it("sorts by priority descending", () => {
    const candidates = selectDigestCandidates([
      recommendation("low", "active", 0.2),
      recommendation("high", "active", 0.9),
      recommendation("mid", "active", 0.5),
    ]);
    expect(candidates.map((c) => c.id)).toEqual(["high", "mid", "low"]);
  });

  it("caps the result at MAX_DIGEST_CANDIDATES", () => {
    const many = Array.from({ length: MAX_DIGEST_CANDIDATES + 5 }, (_, i) =>
      recommendation(`r${i}`, "active", i / 100),
    );
    expect(selectDigestCandidates(many)).toHaveLength(MAX_DIGEST_CANDIDATES);
  });

  it("returns an empty list when nothing is active", () => {
    expect(selectDigestCandidates([recommendation("a", "dismissed", 0.9)])).toEqual([]);
  });
});
