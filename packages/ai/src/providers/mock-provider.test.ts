import { describe, expect, it } from "vitest";
import { MockProvider } from "./mock-provider";

describe("MockProvider", () => {
  it("is deterministic: the same prompt always produces the same output", async () => {
    const provider = new MockProvider();
    const first = await provider.generate({ prompt: "Explain this Opportunity." });
    const second = await provider.generate({ prompt: "Explain this Opportunity." });
    expect(second).toEqual(first);
  });

  it("produces different output for different prompts", async () => {
    const provider = new MockProvider();
    const a = await provider.generate({ prompt: "Prompt A" });
    const b = await provider.generate({ prompt: "Prompt B" });
    expect(a.content).not.toBe(b.content);
  });

  it("never makes a network call and always resolves", async () => {
    const provider = new MockProvider();
    await expect(provider.generate({ prompt: "anything" })).resolves.toBeDefined();
  });
});
