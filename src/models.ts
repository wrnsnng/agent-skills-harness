import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
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

// Try to load OAuth tokens from Claude Code / Codex CLI credentials
function loadClaudeOAuthToken(): string | undefined {
  try {
    const credPath = join(homedir(), ".claude", ".credentials.json");
    if (!existsSync(credPath)) return undefined;
    const creds = JSON.parse(readFileSync(credPath, "utf-8"));
    const oauth = creds?.claudeAiOauth;
    if (!oauth?.accessToken) return undefined;
    // Check expiry
    if (oauth.expiresAt && Date.now() > oauth.expiresAt) {
      console.warn("  ⚠  Claude OAuth token expired — falling back to ANTHROPIC_API_KEY");
      return undefined;
    }
    return oauth.accessToken;
  } catch {
    return undefined;
  }
}

function loadCodexOAuthToken(): string | undefined {
  try {
    const authPath = join(homedir(), ".codex", "auth.json");
    if (!existsSync(authPath)) return undefined;
    const auth = JSON.parse(readFileSync(authPath, "utf-8"));
    // Prefer explicit API key first
    if (auth.OPENAI_API_KEY) return auth.OPENAI_API_KEY;
    // Otherwise use OAuth access token
    if (auth.tokens?.access_token) return auth.tokens.access_token;
    return undefined;
  } catch {
    return undefined;
  }
}

function resolveAnthropicKey(): string | undefined {
  return Bun.env.ANTHROPIC_API_KEY || loadClaudeOAuthToken();
}

function resolveOpenAIKey(): string | undefined {
  return Bun.env.OPENAI_API_KEY || loadCodexOAuthToken();
}

export function hasAnthropic(): boolean {
  return !!resolveAnthropicKey();
}

export function hasOpenAI(): boolean {
  return !!resolveOpenAIKey();
}

let anthropic: Anthropic | null = null;
let openai: OpenAI | null = null;

function getAnthropic(): Anthropic {
  if (!anthropic) {
    const envKey = Bun.env.ANTHROPIC_API_KEY;
    const oauthToken = loadClaudeOAuthToken();
    
    if (envKey) {
      anthropic = new Anthropic({ apiKey: envKey });
    } else if (oauthToken) {
      // OAuth token from Claude Code uses Bearer auth, not x-api-key
      anthropic = new Anthropic({ authToken: oauthToken });
    } else {
      throw new Error("No Anthropic credentials found (set ANTHROPIC_API_KEY or log in with `claude`)");
    }
  }
  return anthropic;
}

function getOpenAI(): OpenAI {
  if (!openai) {
    const key = resolveOpenAIKey();
    if (!key) throw new Error("No OpenAI credentials found (set OPENAI_API_KEY or log in with `codex`)");
    openai = new OpenAI({ apiKey: key });
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
