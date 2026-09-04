import type { AIAPIMode } from "@/ai/config";

export type AIJSONSchema = Record<string, unknown>;

export type AIToolDefinition = {
  name: string;
  description: string;
  parameters: AIJSONSchema;
};

export type AIToolCall = {
  id: string;
  name: string;
  arguments: string;
};

export type AIConversationItem =
  | { type: "message"; role: "user" | "assistant"; content: string }
  | { type: "assistant_tool_calls"; calls: AIToolCall[]; providerItems?: unknown[] }
  | { type: "tool_result"; callId: string; name: string; output: string };

export type AIProviderRequest = {
  model: string;
  instructions: string;
  input: AIConversationItem[];
  tools?: AIToolDefinition[];
  responseSchema?: { name: string; schema: AIJSONSchema };
  maxOutputTokens?: number;
  signal?: AbortSignal;
};

export type AIProviderResponse = {
  text: string;
  toolCalls: AIToolCall[];
  assistantItem: Extract<AIConversationItem, { type: "assistant_tool_calls" }> | null;
  apiMode: Exclude<AIAPIMode, "auto">;
  model: string;
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
};

export type AIStreamEvent =
  | { type: "text_delta"; delta: string }
  | { type: "transport_ready"; apiMode: Exclude<AIAPIMode, "auto"> };

export type AIHealthResult = {
  ok: boolean;
  provider: string;
  model: string;
  apiMode: Exclude<AIAPIMode, "auto"> | null;
  latencyMs: number;
  errorCode?: string;
};

export interface AIProvider {
  generate(request: AIProviderRequest): Promise<AIProviderResponse>;
  stream(request: AIProviderRequest, onEvent?: (event: AIStreamEvent) => void): Promise<AIProviderResponse>;
  healthCheck(signal?: AbortSignal): Promise<AIHealthResult>;
}
