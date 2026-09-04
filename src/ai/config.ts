export type AIAPIMode = "auto" | "responses" | "chat";

export type AIConfig = {
  provider: "openai-compatible";
  baseUrl: string;
  apiKey: string;
  primaryModel: string;
  fastModel: string;
  apiMode: AIAPIMode;
  store: false;
  timeoutMs: number;
  configured: boolean;
};

function parseMode(value: string | undefined): AIAPIMode {
  return value === "responses" || value === "chat" ? value : "auto";
}

function normalizeBaseUrl(value: string) {
  const url = new URL(value);
  if (url.username || url.password) throw new Error("AI_BASE_URL 不能包含凭据");
  return url.toString().replace(/\/$/, "");
}

export function getAIConfig(): AIConfig {
  const apiKey = process.env.AI_API_KEY?.trim() ?? "";
  return {
    provider: "openai-compatible",
    baseUrl: normalizeBaseUrl(process.env.AI_BASE_URL?.trim() || "https://dreamapi.club/v1"),
    apiKey,
    primaryModel: process.env.AI_MODEL_PRIMARY?.trim() || "gpt-5.6-sol",
    fastModel: process.env.AI_MODEL_FAST?.trim() || "gpt-5.4-mini",
    apiMode: parseMode(process.env.AI_API_MODE),
    store: false,
    timeoutMs: Math.max(1_000, Number(process.env.AI_TIMEOUT_MS) || 60_000),
    configured: Boolean(apiKey),
  };
}
