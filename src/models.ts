import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import type { ModelConfig } from "./types.js";

export const MODEL_CONFIGS: Record<string, ModelConfig> = {
  claude: {
    id: "claude",
    name: "Claude Sonnet",
    provider: "anthropic",
    model: "claude-sonnet-4-20250514",
  },
  gpt: {
    id: "gpt",
    name: "GPT-4o",
    provider: "openai",
    model: "gpt-4o",
  },
  o3: {
    id: "o3",
    name: "o3-mini",
    provider: "openai",
    model: "o3-mini",
  },
};

let anthropic: Anthropic | null = null;
let openai: OpenAI | null = null;

function getAnthropic(): Anthropic {
  if (!anthropic) {
    anthropic = new Anthropic({ apiKey: Bun.env.ANTHROPIC_API_KEY });
  }
  return anthropic;
}

function getOpenAI(): OpenAI {
  if (!openai) {
    openai = new OpenAI({ apiKey: Bun.env.OPENAI_API_KEY });
  }
  return openai;
}

export async function callModel(
  config: ModelConfig,
  systemPrompt: string,
  userPrompt: string
): Promise<string> {
  if (config.provider === "anthropic") {
    const resp = await getAnthropic().messages.create({
      model: config.model,
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    });
    return resp.content
      .filter((b) => b.type === "text")
      .map((b) => (b as any).text)
      .join("\n");
  }

  const resp = await getOpenAI().chat.completions.create({
    model: config.model,
    max_tokens: 4096,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  });
  return resp.choices[0]?.message?.content ?? "";
}
