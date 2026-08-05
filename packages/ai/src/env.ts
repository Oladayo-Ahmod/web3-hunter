import { createEnv } from "@web3-hunter/shared";
import { z } from "zod";

/**
 * Every field here is optional — per Milestone 7's "AI is optional"
 * requirement, an unconfigured environment must never throw, only
 * result in `getAIProvider()` returning `null`. Contrast with
 * `@web3-hunter/db`'s `DATABASE_URL`, which is required because the
 * deterministic pipeline cannot function without it; nothing in this
 * package is load-bearing for the deterministic pipeline.
 */
const schema = z.object({
  AI_PROVIDER: z.enum(["openai", "anthropic", "mock"]).optional(),
  OPENAI_API_KEY: z.string().min(1).optional(),
  OPENAI_MODEL: z.string().min(1).optional(),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  ANTHROPIC_MODEL: z.string().min(1).optional(),
});

export type AIEnv = z.infer<typeof schema>;

let cached: AIEnv | undefined;

/**
 * Validates and returns this package's environment configuration,
 * memoized after the first call. Lazy for the same reason
 * `@web3-hunter/db`'s `getDbEnv` is: importing this package must never
 * require a configured provider — only generating content should.
 */
export function getAIEnv(): AIEnv {
  cached ??= createEnv(schema);
  return cached;
}

/** Test-only: clears the memoized environment so a test can reconfigure `process.env` and re-resolve. */
export function resetAIEnvCache(): void {
  cached = undefined;
}
