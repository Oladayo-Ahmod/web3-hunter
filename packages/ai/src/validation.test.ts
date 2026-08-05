import { describe, expect, it } from "vitest";
import { InvalidAIOutputError, validateAIOutput } from "./validation";

describe("validateAIOutput", () => {
  it("returns trimmed content for valid plain text", () => {
    expect(validateAIOutput("  Hello, this is a summary.  ")).toBe("Hello, this is a summary.");
  });

  it("rejects empty content", () => {
    expect(() => validateAIOutput("   ")).toThrow(InvalidAIOutputError);
  });

  it("rejects content exceeding the maximum length", () => {
    expect(() => validateAIOutput("a".repeat(5000))).toThrow(InvalidAIOutputError);
  });

  it("rejects content containing markup", () => {
    expect(() => validateAIOutput("Hello <script>alert(1)</script>")).toThrow(InvalidAIOutputError);
  });

  it("accepts content with a bare angle bracket used as a comparison operator", () => {
    expect(() => validateAIOutput("Score 5 < 10")).not.toThrow();
  });
});
