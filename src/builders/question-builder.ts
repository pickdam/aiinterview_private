import type { QuestionConfig } from "./types";

export class QuestionBuilder {
  private config: Partial<QuestionConfig> = {};

  transcript(text: string): this {
    this.config.transcript = text;
    return this;
  }

  category(cat: string): this {
    this.config.category = cat;
    return this;
  }

  displayText(text: string): this {
    this.config.displayText = text;
    return this;
  }

  subCategory(sub: string): this {
    this.config.subCategory = sub;
    return this;
  }

  language(lang: "ja" | "en"): this {
    this.config.language = lang;
    return this;
  }

  timeLimit(seconds: number): this {
    this.config.timeLimit = seconds;
    return this;
  }

  deepDives(min: number, max: number): this {
    this.config.minDeepDives = min;
    this.config.maxDeepDives = max;
    return this;
  }

  customSystemPrompt(promptId: number | null): this {
    this.config.questionCustomSystemPromptId = promptId;
    return this;
  }

  /** Internal: extract the config (not for external use) */
  _toConfig(): QuestionConfig {
    if (!this.config.transcript || !this.config.category) {
      throw new Error(
        "Question must have transcript and category before building",
      );
    }
    return this.config as QuestionConfig;
  }
}
