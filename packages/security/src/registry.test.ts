import { describe, expect, it } from "vitest";
import {
  isRegisteredSecuritySignalType,
  listSecuritySignalDetectors,
  listSecuritySignalTypes,
  registerSecuritySignalDetector,
  registerSecuritySignalType,
} from "./registry";

describe("Phase 1: the Security Signal detector registry is empty", () => {
  it("starts with no registered detectors, since no detector module registers itself yet", () => {
    expect(listSecuritySignalDetectors()).toHaveLength(0);
  });

  it("starts with no registered signal types", () => {
    expect(listSecuritySignalTypes()).toHaveLength(0);
  });
});

describe("registerSecuritySignalType", () => {
  it("registers a new signal type", () => {
    registerSecuritySignalType("__test__signal-type");
    expect(isRegisteredSecuritySignalType("__test__signal-type")).toBe(true);
    expect(listSecuritySignalTypes()).toContain("__test__signal-type");
  });

  it("rejects registering the same name twice", () => {
    registerSecuritySignalType("__test__duplicate-signal-type");
    expect(() => registerSecuritySignalType("__test__duplicate-signal-type")).toThrowError(
      /already registered/i,
    );
  });
});

describe("registerSecuritySignalDetector / listSecuritySignalDetectors", () => {
  it("adds a new detector without requiring any change to the registry itself", () => {
    const before = listSecuritySignalDetectors().length;

    const testDetector = () => [];
    registerSecuritySignalDetector(testDetector);

    const after = listSecuritySignalDetectors();
    expect(after).toHaveLength(before + 1);
    expect(after).toContain(testDetector);
  });
});
