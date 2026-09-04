import { getAIConfig } from "@/ai/config";
import { OpenAICompatibleProvider } from "./openai-compatible";
import type { AIProvider } from "./types";

let singleton: AIProvider | null = null;

export function getAIProvider() {
  singleton ??= new OpenAICompatibleProvider(getAIConfig());
  return singleton;
}
export function setAIProviderForTests(provider: AIProvider | null) {
  singleton = provider;
}
