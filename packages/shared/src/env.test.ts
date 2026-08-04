import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createEnv } from "./env";

describe("createEnv", () => {
  const schema = z.object({
    FOO: z.string().min(1),
  });

  it("returns parsed, typed values when the source is valid", () => {
    const result = createEnv(schema, { FOO: "bar" });

    expect(result).toEqual({ FOO: "bar" });
  });

  it("throws a descriptive error when a required variable is missing", () => {
    expect(() => createEnv(schema, {})).toThrowError(/FOO/);
  });

  it("throws a descriptive error when a variable fails validation", () => {
    expect(() => createEnv(schema, { FOO: "" })).toThrowError(/FOO/);
  });
});
