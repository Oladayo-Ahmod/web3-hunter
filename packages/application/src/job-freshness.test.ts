import { describe, expect, it } from "vitest";
import { computeJobFreshness } from "./job-freshness";

const NOW = new Date("2026-08-11T00:00:00.000Z");

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);
}

describe("computeJobFreshness", () => {
  it("buckets 0-7 days as fresh", () => {
    expect(computeJobFreshness(daysAgo(0), NOW)).toBe("fresh");
    expect(computeJobFreshness(daysAgo(7), NOW)).toBe("fresh");
  });

  it("buckets 8-30 days as recent", () => {
    expect(computeJobFreshness(daysAgo(8), NOW)).toBe("recent");
    expect(computeJobFreshness(daysAgo(30), NOW)).toBe("recent");
  });

  it("buckets 31-60 days as aging", () => {
    expect(computeJobFreshness(daysAgo(31), NOW)).toBe("aging");
    expect(computeJobFreshness(daysAgo(60), NOW)).toBe("aging");
  });

  it("buckets 61+ days as stale", () => {
    expect(computeJobFreshness(daysAgo(61), NOW)).toBe("stale");
    expect(computeJobFreshness(daysAgo(2007), NOW)).toBe("stale");
  });

  it("clamps a source timestamp ahead of now (clock skew) to fresh, never negative", () => {
    expect(computeJobFreshness(daysAgo(-5), NOW)).toBe("fresh");
  });
});
