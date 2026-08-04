import { describe, expect, it } from "vitest";
import { computePriority } from "./priority";
import type { PriorityInputs } from "./types";

const ASOF = new Date("2026-03-01T00:00:00Z");

const BASE: PriorityInputs = {
  matchScore: 0.8,
  intelligenceConfidence: 0.6,
  intelligenceAsOf: ASOF,
  recommendationCreatedAt: ASOF,
  asOf: ASOF,
};

describe("computePriority", () => {
  it("is deterministic: the same inputs always produce the same priority", () => {
    const first = computePriority({ ...BASE });
    const second = computePriority({ ...BASE });
    expect(second).toBe(first);
  });

  it("returns a value within [0, 1]", () => {
    const priority = computePriority(BASE);
    expect(priority).toBeGreaterThanOrEqual(0);
    expect(priority).toBeLessThanOrEqual(1);
  });

  it("increases with Match score, holding everything else constant", () => {
    const low = computePriority({ ...BASE, matchScore: 0.2 });
    const high = computePriority({ ...BASE, matchScore: 0.9 });
    expect(high).toBeGreaterThan(low);
  });

  it("increases with Intelligence confidence, holding everything else constant", () => {
    const low = computePriority({ ...BASE, intelligenceConfidence: 0.1 });
    const high = computePriority({ ...BASE, intelligenceConfidence: 0.9 });
    expect(high).toBeGreaterThan(low);
  });

  it("decreases as Intelligence goes stale", () => {
    const fresh = computePriority({ ...BASE, intelligenceAsOf: ASOF });
    const stale = computePriority({
      ...BASE,
      intelligenceAsOf: new Date(ASOF.getTime() - 25 * 24 * 60 * 60 * 1000),
    });
    expect(stale).toBeLessThan(fresh);
  });

  it("decreases as the Recommendation ages", () => {
    const justCreated = computePriority({ ...BASE, recommendationCreatedAt: ASOF });
    const old = computePriority({
      ...BASE,
      recommendationCreatedAt: new Date(ASOF.getTime() - 20 * 24 * 60 * 60 * 1000),
    });
    expect(old).toBeLessThan(justCreated);
  });

  it("never goes negative even for a very old, very stale Recommendation", () => {
    const priority = computePriority({
      matchScore: 0.1,
      intelligenceConfidence: 0.1,
      intelligenceAsOf: new Date(ASOF.getTime() - 400 * 24 * 60 * 60 * 1000),
      recommendationCreatedAt: new Date(ASOF.getTime() - 400 * 24 * 60 * 60 * 1000),
      asOf: ASOF,
    });
    expect(priority).toBe(0);
  });
});
