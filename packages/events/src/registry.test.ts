import { describe, expect, it } from "vitest";
import { z } from "zod";
import { getEventType, isRegisteredEventType, listEventTypes, registerEventType } from "./registry";

describe("registerEventType / getEventType", () => {
  it("registers a new event type and makes it retrievable by name", () => {
    const definition = registerEventType({
      name: "__test__RegistryBasic",
      category: "source",
      version: 1,
      metadataSchema: z.object({ value: z.string() }),
    });

    expect(getEventType("__test__RegistryBasic")).toBe(definition);
    expect(isRegisteredEventType("__test__RegistryBasic")).toBe(true);
  });

  it("returns undefined for an unregistered type name", () => {
    expect(getEventType("__test__DoesNotExist")).toBeUndefined();
    expect(isRegisteredEventType("__test__DoesNotExist")).toBe(false);
  });

  it("rejects registering the same name twice", () => {
    registerEventType({
      name: "__test__RegistryDuplicate",
      category: "source",
      version: 1,
      metadataSchema: z.unknown(),
    });

    expect(() =>
      registerEventType({
        name: "__test__RegistryDuplicate",
        category: "decision",
        version: 1,
        metadataSchema: z.unknown(),
      }),
    ).toThrowError(/already registered/i);
  });

  it("rejects a non-positive-integer version", () => {
    expect(() =>
      registerEventType({
        name: "__test__RegistryBadVersion",
        category: "source",
        version: 0,
        metadataSchema: z.unknown(),
      }),
    ).toThrowError(/invalid version/i);
  });

  it("lists every registered type, including ones registered by this test file", () => {
    registerEventType({
      name: "__test__RegistryListed",
      category: "user",
      version: 1,
      metadataSchema: z.unknown(),
    });

    const names = listEventTypes().map((definition) => definition.name);
    expect(names).toContain("__test__RegistryListed");
  });
});
