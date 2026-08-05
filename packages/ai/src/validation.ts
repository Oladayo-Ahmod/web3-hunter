const MIN_CONTENT_LENGTH = 1;
const MAX_CONTENT_LENGTH = 4000;

export class InvalidAIOutputError extends Error {
  constructor(reason: string) {
    super(`Invalid AI output: ${reason}`);
    this.name = "InvalidAIOutputError";
  }
}

/**
 * Validates raw provider output before it is ever persisted or rendered
 * — the baseline check every generation function runs, per Milestone
 * 7's "plain-text output only with validation" requirement. Rejects
 * empty output, output that's implausibly long (a sign of a runaway or
 * malformed response), and any embedded markup — this content is always
 * rendered as plain text (see the UI layer), never as HTML, so an AI
 * response that already contains tags is treated as malformed rather
 * than silently trusted.
 */
export function validateAIOutput(content: string): string {
  const trimmed = content.trim();

  if (trimmed.length < MIN_CONTENT_LENGTH) {
    throw new InvalidAIOutputError("content is empty");
  }
  if (trimmed.length > MAX_CONTENT_LENGTH) {
    throw new InvalidAIOutputError(`content exceeds ${MAX_CONTENT_LENGTH} characters`);
  }
  if (/<[a-z][\s\S]*>/i.test(trimmed)) {
    throw new InvalidAIOutputError("content contains markup, which is never rendered as HTML");
  }

  return trimmed;
}
