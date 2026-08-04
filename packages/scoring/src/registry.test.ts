import { describe, expect, it } from "vitest";
import {
  isRegisteredSignalType,
  listSignalDetectors,
  listSignalTypes,
  registerSignalDetector,
  registerSignalType,
} from "./registry";

describe("registerSignalType", () => {
  it("registers a new signal type", () => {
    registerSignalType("__test__signal-type");
    expect(isRegisteredSignalType("__test__signal-type")).toBe(true);
    expect(listSignalTypes()).toContain("__test__signal-type");
  });

  it("rejects registering the same name twice", () => {
    registerSignalType("__test__duplicate-signal-type");
    expect(() => registerSignalType("__test__duplicate-signal-type")).toThrowError(
      /already registered/i,
    );
  });
});

describe("registerSignalDetector / listSignalDetectors", () => {
  it("adds a new detector without requiring any change to existing detectors or the runner", () => {
    const before = listSignalDetectors().length;

    const testDetector = () => [];
    registerSignalDetector(testDetector);

    const after = listSignalDetectors();
    expect(after).toHaveLength(before + 1);
    expect(after).toContain(testDetector);
  });
});
