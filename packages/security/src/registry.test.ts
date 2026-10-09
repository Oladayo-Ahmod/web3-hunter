import { describe, expect, it } from "vitest";
import {
  doesSignalTypeQualifyForOpportunity,
  isRegisteredSecuritySignalType,
  listSecuritySignalDetectors,
  listSecuritySignalTypes,
  registerSecuritySignalDetector,
  registerSecuritySignalType,
} from "./registry";

describe("a fresh registry module instance", () => {
  it("starts with no registered detectors or signal types", () => {
    expect(listSecuritySignalDetectors()).toHaveLength(0);
    expect(listSecuritySignalTypes()).toHaveLength(0);
  });
});

describe("registerSecuritySignalType", () => {
  it("registers a new signal type with its declared opportunity-qualification stance", () => {
    registerSecuritySignalType("__test__signal-type", { qualifiesForOpportunity: true });
    expect(isRegisteredSecuritySignalType("__test__signal-type")).toBe(true);
    expect(listSecuritySignalTypes()).toContain("__test__signal-type");
    expect(doesSignalTypeQualifyForOpportunity("__test__signal-type")).toBe(true);
  });

  it("rejects registering the same name twice", () => {
    registerSecuritySignalType("__test__duplicate-signal-type", { qualifiesForOpportunity: false });
    expect(() =>
      registerSecuritySignalType("__test__duplicate-signal-type", {
        qualifiesForOpportunity: false,
      }),
    ).toThrowError(/already registered/i);
  });
});

describe("doesSignalTypeQualifyForOpportunity", () => {
  it("returns false for a type registered with qualifiesForOpportunity: false", () => {
    registerSecuritySignalType("__test__non-qualifying", { qualifiesForOpportunity: false });
    expect(doesSignalTypeQualifyForOpportunity("__test__non-qualifying")).toBe(false);
  });

  it("returns false for a name that was never registered", () => {
    expect(doesSignalTypeQualifyForOpportunity("__test__never-registered")).toBe(false);
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
