import type { z } from "zod";

/**
 * Parses and validates a set of environment variables against a Zod schema,
 * failing fast with a single, readable error instead of letting an invalid
 * or missing variable surface later as a confusing runtime failure.
 */
export function createEnv<TSchema extends z.ZodType>(
  schema: TSchema,
  source: NodeJS.ProcessEnv = process.env,
): z.infer<TSchema> {
  const parsed = schema.safeParse(source);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");

    throw new Error(`Invalid environment variables:\n${issues}`);
  }

  return parsed.data as z.infer<TSchema>;
}
