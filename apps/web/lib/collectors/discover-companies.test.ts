import { describe, expect, it } from "vitest";
import { classifyFetchFailure } from "./discover-companies";

describe("classifyFetchFailure", () => {
  it("classifies a confirmed 404 as a confident miss", () => {
    const error = new Error('Greenhouse API request failed for board "x": 404 Not Found');
    expect(classifyFetchFailure(error)).toBe("miss");
  });

  it("classifies a 5xx server error as a retryable error, not a miss", () => {
    const error = new Error('Lever API request failed for site "x": 503 Service Unavailable');
    expect(classifyFetchFailure(error)).toBe("error");
  });

  it("classifies a network-level failure (no HTTP response at all) as a retryable error", () => {
    const error = new Error("fetch failed");
    expect(classifyFetchFailure(error)).toBe("error");
  });

  it("classifies a non-Error thrown value as a retryable error, never a false miss", () => {
    expect(classifyFetchFailure("something unexpected")).toBe("error");
    expect(classifyFetchFailure(undefined)).toBe("error");
  });

  it("does not false-positive on a 404-like number appearing elsewhere in an unrelated message", () => {
    // A deliberately adversarial case: "4040" contains "404" as a
    // substring but is not the same number - the regex must not match.
    const error = new Error('Ashby API request failed for board "x": 4040 Weird Status');
    // "4040" contains the digit sequence 404 but \b404\b requires a word
    // boundary on both sides - "4040" fails that (no boundary before the
    // trailing "0"), so this correctly does NOT classify as a miss.
    expect(classifyFetchFailure(error)).toBe("error");
  });
});
