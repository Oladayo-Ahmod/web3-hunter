import { describe, expect, it } from "vitest";
import { listTechnologyDetectors, registerTechnologyDetector } from "./registry";
import type { TechnologyDetector } from "./types";

describe("registry", () => {
  it("returns every registered detector, in registration order", () => {
    const before = listTechnologyDetectors().length;

    const detectorA: TechnologyDetector = () => [];
    const detectorB: TechnologyDetector = () => [];
    registerTechnologyDetector(detectorA);
    registerTechnologyDetector(detectorB);

    const after = listTechnologyDetectors();
    expect(after).toHaveLength(before + 2);
    expect(after.slice(-2)).toEqual([detectorA, detectorB]);
  });

  it("is open for extension: a newly registered detector is immediately listed", () => {
    const before = listTechnologyDetectors().length;
    registerTechnologyDetector(() => []);
    expect(listTechnologyDetectors()).toHaveLength(before + 1);
  });
});
