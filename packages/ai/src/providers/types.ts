/**
 * The provider abstraction every AI Layer generation function is built
 * on. Business logic (prompt construction, caching, versioning,
 * validation) never depends on which provider is configured — it only
 * ever calls `AIProvider.generate`. No package outside `packages/ai` may
 * import an LLM SDK directly; this interface is the only surface other
 * code in this package sees.
 */
export interface AIGenerationRequest {
  prompt: string;
  maxOutputTokens?: number;
}

export interface AIGenerationResult {
  content: string;
  model: string;
}

export interface AIProvider {
  readonly name: string;
  generate(request: AIGenerationRequest): Promise<AIGenerationResult>;
}
