import { createHash } from "node:crypto";
import type { AIGenerationRequest, AIGenerationResult, AIProvider } from "./types";

/**
 * A deterministic, offline provider — no network call, no API key.
 * Exercised by every automated test in this package (and, by extension,
 * every consumer's tests): "Mock provider passes all tests" is a
 * Milestone 7 acceptance criterion. Output is a short, stable function of
 * the prompt (a content hash), so two calls with the same prompt produce
 * identical output — useful for asserting caching behavior without
 * depending on real generation being deterministic.
 */
export class MockProvider implements AIProvider {
  readonly name = "mock";

  async generate(request: AIGenerationRequest): Promise<AIGenerationResult> {
    const digest = createHash("sha256").update(request.prompt).digest("hex").slice(0, 12);
    return Promise.resolve({
      content: `[mock:${digest}] ${request.prompt.slice(0, 160)}`,
      model: "mock-v1",
    });
  }
}
