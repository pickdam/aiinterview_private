import process from "process";

import type { APIRequestContext, APIResponse, Page } from "@playwright/test";
import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  LmStudioModelsResponse,
} from "@src/api/types";

export class LmStudioApi {
  private readonly request: APIRequestContext;
  private readonly baseUrl: string;
  private readonly systemPrompt =
    "Answer the following question EXACTLY in the language it was asked in.";

  constructor(page: Page) {
    this.request = page.request;
    this.baseUrl = process.env.LM_STUDIO_BASE_URL ?? "http://localhost:1234/v1";
  }

  private url(path: string): string {
    return `${this.baseUrl}/${path}`;
  }

  /**
   * Get list of available models
   */
  async getModels(): Promise<APIResponse> {
    return this.request.get(this.url("models"));
  }

  /**
   * Send a chat completion request
   */
  async createChatCompletion(
    data: ChatCompletionRequest,
  ): Promise<APIResponse> {
    return this.request.post(this.url("chat/completions"), { data });
  }

  /**
   * Convenience method: Ask a question and get the response text
   * Automatically includes the system prompt
   */
  async ask(
    userMessage: string,
    options?: {
      maxTokens?: number;
      systemPrompt?: string;
      temperature?: number;
    },
  ): Promise<string> {
    const request: ChatCompletionRequest = {
      messages: [
        { role: "system", content: options?.systemPrompt ?? this.systemPrompt },
        { role: "user", content: userMessage },
      ],
      temperature: options?.temperature ?? 0.7,
      max_tokens: options?.maxTokens,
    };

    const response = await this.createChatCompletion(request);

    if (!response.ok()) {
      const text = await response.text();
      throw new Error(
        `LM Studio request failed: ${response.status()} - ${text}`,
      );
    }

    const body: ChatCompletionResponse = await response.json();
    return body.choices[0]?.message?.content ?? "";
  }

  /**
   * Get the currently loaded model name
   */
  async getCurrentModel(): Promise<string> {
    const response = await this.getModels();

    if (!response.ok()) {
      throw new Error(`Failed to get models: ${response.status()}`);
    }

    const body: LmStudioModelsResponse = await response.json();
    return body.data[0]?.id ?? "unknown";
  }
}
