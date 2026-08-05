import Anthropic from "@anthropic-ai/sdk";
import type { AIGenerationRequest, AIGenerationResult, AIProvider } from "./types";

const DEFAULT_MODEL = "claude-opus-5";
const DEFAULT_MAX_OUTPUT_TOKENS = 1024;

export class AnthropicProvider implements AIProvider {
  readonly name = "anthropic";

  constructor(
    private readonly apiKey: string,
    private readonly model: string = DEFAULT_MODEL,
  ) {}

  async generate(request: AIGenerationRequest): Promise<AIGenerationResult> {
    const client = new Anthropic({ apiKey: this.apiKey });

    const response = await client.messages.create({
      model: this.model,
      max_tokens: request.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
      messages: [{ role: "user", content: request.prompt }],
    });

    if (response.stop_reason === "refusal") {
      throw new Error("Anthropic declined to generate content for this prompt.");
    }

    const textBlock = response.content.find((block) => block.type === "text");
    if (!textBlock) {
      throw new Error("Anthropic response contained no text content.");
    }

    return { content: textBlock.text, model: response.model };
  }
}
