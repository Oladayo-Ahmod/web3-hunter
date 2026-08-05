/** The content of a generated (or cached) AI artifact, independent of which artifact type it is. */
export interface AIArtifactResult {
  content: string;
  version: number;
  promptVersion: number;
  provider: string;
  model: string;
  generatedAt: Date;
}

/**
 * Every generation function returns this shape. `available: false` means
 * AI is unconfigured (no provider) — never an error, per Milestone 7's
 * "AI is optional" requirement; callers render nothing (or a "Generate"
 * prompt) rather than propagating a failure.
 */
export type AIGenerationOutcome =
  { available: true; artifact: AIArtifactResult; cached: boolean } | { available: false };

/**
 * Narrows any persisted artifact row (which also carries its own `id`
 * and source-entity foreign key) down to the stable `AIArtifactResult`
 * contract — callers (the cached-return path in every store, and API
 * routes that pass a store's result straight through) must never leak
 * the raw row shape.
 */
export function toArtifactResult(row: {
  content: string;
  version: number;
  promptVersion: number;
  provider: string;
  model: string;
  generatedAt: Date;
}): AIArtifactResult {
  return {
    content: row.content,
    version: row.version,
    promptVersion: row.promptVersion,
    provider: row.provider,
    model: row.model,
    generatedAt: row.generatedAt,
  };
}
