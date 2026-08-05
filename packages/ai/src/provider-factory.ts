import { getAIEnv, resetAIEnvCache } from "./env";
import { AnthropicProvider } from "./providers/anthropic-provider";
import { MockProvider } from "./providers/mock-provider";
import { OpenAIProvider } from "./providers/openai-provider";
import type { AIProvider } from "./providers/types";

let cached: AIProvider | null | undefined;

/**
 * Returns the configured `AIProvider`, or `null` when AI is unavailable —
 * unset `AI_PROVIDER`, or a provider selected without its API key. Never
 * throws: per Milestone 7's "AI is optional" requirement, every caller
 * must be able to treat a `null` return as "skip AI enrichment," not as
 * an error to propagate. Selection is entirely configuration-driven —
 * nothing in this package's business logic branches on which provider is
 * active.
 */
export function getAIProvider(): AIProvider | null {
  if (cached !== undefined) {
    return cached;
  }

  const env = getAIEnv();

  switch (env.AI_PROVIDER) {
    case "mock":
      cached = new MockProvider();
      break;
    case "openai":
      cached = env.OPENAI_API_KEY ? new OpenAIProvider(env.OPENAI_API_KEY, env.OPENAI_MODEL) : null;
      break;
    case "anthropic":
      cached = env.ANTHROPIC_API_KEY
        ? new AnthropicProvider(env.ANTHROPIC_API_KEY, env.ANTHROPIC_MODEL)
        : null;
      break;
    default:
      cached = null;
  }

  return cached;
}

/** Test-only: clears the memoized provider (and the underlying memoized environment) so a test can reconfigure `process.env` and re-resolve. */
export function resetAIProviderCache(): void {
  cached = undefined;
  resetAIEnvCache();
}
