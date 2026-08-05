import { describe, expect, it } from "vitest";
import {
  computeCompanyTechnologyProfile,
  technologyProfileStatesEqual,
} from "./technology-profile";
import type { TechnologyDetectionSummary } from "./types";

function detection(
  skillId: string,
  detectedAt = "2026-01-01T00:00:00Z",
): TechnologyDetectionSummary {
  return { id: `det-${skillId}-${detectedAt}`, skillId, detectedAt: new Date(detectedAt) };
}

describe("computeCompanyTechnologyProfile", () => {
  it("returns an empty profile for no detections", () => {
    expect(computeCompanyTechnologyProfile([])).toEqual({ skillIds: [], evidenceCount: 0 });
  });

  it("deduplicates repeated evidence for the same Skill into one skillId entry", () => {
    const result = computeCompanyTechnologyProfile([
      detection("skill-rust", "2026-01-01T00:00:00Z"),
      detection("skill-rust", "2026-01-02T00:00:00Z"),
    ]);
    expect(result.skillIds).toEqual(["skill-rust"]);
    // evidenceCount still reflects every detection, even repeated ones for the same Skill.
    expect(result.evidenceCount).toBe(2);
  });

  it("produces a stable, sorted skillIds order regardless of input order", () => {
    const a = computeCompanyTechnologyProfile([detection("skill-b"), detection("skill-a")]);
    const b = computeCompanyTechnologyProfile([detection("skill-a"), detection("skill-b")]);
    expect(a.skillIds).toEqual(b.skillIds);
    expect(a.skillIds).toEqual(["skill-a", "skill-b"]);
  });
});

describe("technologyProfileStatesEqual", () => {
  it("is true for identical states", () => {
    const state = { skillIds: ["a", "b"], evidenceCount: 2 };
    expect(technologyProfileStatesEqual(state, { skillIds: ["a", "b"], evidenceCount: 2 })).toBe(
      true,
    );
  });

  it("is false when evidenceCount differs", () => {
    expect(
      technologyProfileStatesEqual(
        { skillIds: ["a"], evidenceCount: 1 },
        { skillIds: ["a"], evidenceCount: 2 },
      ),
    ).toBe(false);
  });

  it("is false when skillIds differ", () => {
    expect(
      technologyProfileStatesEqual(
        { skillIds: ["a"], evidenceCount: 1 },
        { skillIds: ["b"], evidenceCount: 1 },
      ),
    ).toBe(false);
  });
});
