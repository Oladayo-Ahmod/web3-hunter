import OpenAI from "openai";
import type { AIGenerationRequest, AIGenerationResult, AIProvider } from "./types";

const DEFAULT_MODEL = "gpt-4o-mini";
const DEFAULT_MAX_OUTPUT_TOKENS = 1024;

export class OpenAIProvider implements AIProvider {
  readonly name = "openai";

  constructor(
    private readonly apiKey: string,
    private readonly model: string = DEFAULT_MODEL,
  ) {}

  async generate(request: AIGenerationRequest): Promise<AIGenerationResult> {
    const client = new OpenAI({ apiKey: this.apiKey });

    const response = await client.chat.completions.create({
      model: this.model,
      max_completion_tokens: request.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
      messages: [{ role: "user", content: request.prompt }],
    });

    const content = response.choices[0]?.message.content;
    if (!content) {
      throw new Error("OpenAI response contained no content.");
    }

    return { content, model: response.model };
  }
}
