import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getAIProvider, resetAIProviderCache } from "./provider-factory";

const ENV_KEYS = ["AI_PROVIDER", "OPENAI_API_KEY", "ANTHROPIC_API_KEY"] as const;
const originalEnv: Record<string, string | undefined> = {};

describe("getAIProvider", () => {
  beforeEach(() => {
    for (const key of ENV_KEYS) {
      originalEnv[key] = process.env[key];
      delete process.env[key];
    }
    resetAIProviderCache();
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (originalEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = originalEnv[key];
      }
    }
    resetAIProviderCache();
  });

  it("returns null when AI_PROVIDER is unset — AI is optional by default", () => {
    expect(getAIProvider()).toBeNull();
  });

  it("returns the Mock provider when AI_PROVIDER=mock", () => {
    process.env.AI_PROVIDER = "mock";
    expect(getAIProvider()?.name).toBe("mock");
  });

  it("returns null when AI_PROVIDER=openai but OPENAI_API_KEY is not set", () => {
    process.env.AI_PROVIDER = "openai";
    expect(getAIProvider()).toBeNull();
  });

  it("returns the OpenAI provider when AI_PROVIDER=openai and OPENAI_API_KEY is set", () => {
    process.env.AI_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "test-key";
    expect(getAIProvider()?.name).toBe("openai");
  });

  it("returns null when AI_PROVIDER=anthropic but ANTHROPIC_API_KEY is not set", () => {
    process.env.AI_PROVIDER = "anthropic";
    expect(getAIProvider()).toBeNull();
  });

  it("returns the Anthropic provider when AI_PROVIDER=anthropic and ANTHROPIC_API_KEY is set", () => {
    process.env.AI_PROVIDER = "anthropic";
    process.env.ANTHROPIC_API_KEY = "test-key";
    expect(getAIProvider()?.name).toBe("anthropic");
  });

  it("memoizes the provider until the cache is reset", () => {
    process.env.AI_PROVIDER = "mock";
    const first = getAIProvider();
    process.env.AI_PROVIDER = "openai";
    const second = getAIProvider();
    expect(second).toBe(first);
  });
});
