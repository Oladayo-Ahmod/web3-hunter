import { describe, expect, it } from "vitest";
import { listSkillClassifiers, registerSkillClassifier } from "./registry";
import type { SkillClassifier } from "./types";

describe("registry", () => {
  it("returns every registered classifier, in registration order", () => {
    const before = listSkillClassifiers().length;

    const classifierA: SkillClassifier = () => [];
    const classifierB: SkillClassifier = () => [];
    registerSkillClassifier(classifierA);
    registerSkillClassifier(classifierB);

    const after = listSkillClassifiers();
    expect(after).toHaveLength(before + 2);
    expect(after.slice(-2)).toEqual([classifierA, classifierB]);
  });

  it("is open for extension: a newly registered classifier is immediately listed", () => {
    const before = listSkillClassifiers().length;
    registerSkillClassifier(() => []);
    expect(listSkillClassifiers()).toHaveLength(before + 1);
  });
});
