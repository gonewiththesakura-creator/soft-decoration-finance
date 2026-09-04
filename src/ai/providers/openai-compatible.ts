import type { AIConfig, AIAPIMode } from "@/ai/config";
import type {
  AIConversationItem,
  AIHealthResult,
  AIProvider,
  AIProviderRequest,
  AIProviderResponse,
  AIStreamEvent,
  AIToolCall,
} from "./types";

type ConcreteMode = Exclude<AIAPIMode, "auto">;

export class AIProviderError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status?: number,
    public readonly retryable = false,
    public readonly endpointUnsupported = false,
  ) {
    super(message);
    this.name = "AIProviderError";
  }
}

function errorCode(payload: unknown) {
  if (!payload || typeof payload !== "object") return "PROVIDER_ERROR";
  const root = payload as { code?: unknown; error?: { code?: unknown; type?: unknown } };
  return String(root.error?.code ?? root.error?.type ?? root.code ?? "PROVIDER_ERROR").toUpperCase();
}

function errorMessage(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== "object") return fallback;
  const root = payload as { message?: unknown; error?: { message?: unknown } };
  return String(root.error?.message ?? root.message ?? fallback).slice(0, 300);
}

function isUnsupported(status: number, payload: unknown) {
  if (status === 404 || status === 405) return true;
  const code = errorCode(payload).toLowerCase();
  const message = errorMessage(payload, "").toLowerCase();
  return code.includes("not_implemented") || code.includes("unsupported_endpoint")
    || message.includes("endpoint") && (message.includes("not supported") || message.includes("not implemented"));
}

function isRetryableStatus(status: number) {
  return status === 408 || status === 429 || status >= 500;
}

function combineSignal(timeoutMs: number, external?: AbortSignal) {
  const timeout = AbortSignal.timeout(timeoutMs);
  return external ? AbortSignal.any([external, timeout]) : timeout;
}

function responsesInput(items: AIConversationItem[]) {
  return items.flatMap((item) => {
    if (item.type === "message") return [{ role: item.role, content: item.content }];
    if (item.type === "tool_result") return [{ type: "function_call_output", call_id: item.callId, output: item.output }];
    if (item.providerItems?.length) return item.providerItems;
    return item.calls.map((call) => ({ type: "function_call", call_id: call.id, name: call.name, arguments: call.arguments }));
  });
}

function chatMessages(instructions: string, items: AIConversationItem[]) {
  return [
    { role: "system", content: instructions },
    ...items.map((item) => {
      if (item.type === "message") return { role: item.role, content: item.content };
      if (item.type === "tool_result") return { role: "tool", tool_call_id: item.callId, content: item.output };
      return {
        role: "assistant",
        content: null,
        tool_calls: item.calls.map((call) => ({ id: call.id, type: "function", function: { name: call.name, arguments: call.arguments } })),
      };
    }),
  ];
}

function parseResponses(payload: unknown, model: string): Omit<AIProviderResponse, "apiMode"> {
  const root = payload as {
    model?: string;
    output_text?: string;
    output?: Array<{ type?: string; id?: string; call_id?: string; name?: string; arguments?: string; content?: Array<{ type?: string; text?: string }> }>;
    usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number };
  };
  const output = root.output ?? [];
  const toolItems = output.filter((item) => item.type === "function_call");
  const toolCalls = toolItems.map((item, index) => ({
    id: String(item.call_id ?? item.id ?? `call_${index}`),
    name: String(item.name ?? ""),
    arguments: String(item.arguments ?? "{}"),
  }));
  const text = root.output_text ?? output.flatMap((item) => item.content ?? [])
    .filter((item) => item.type === "output_text")
    .map((item) => item.text ?? "").join("");
  return {
    text,
    toolCalls,
    // Stateless Responses calls must replay every output item, including reasoning,
    // before sending function_call_output items on the next turn.
    assistantItem: toolCalls.length ? { type: "assistant_tool_calls", calls: toolCalls, providerItems: output } : null,
    model: root.model ?? model,
    usage: root.usage ? { inputTokens: root.usage.input_tokens, outputTokens: root.usage.output_tokens, totalTokens: root.usage.total_tokens } : undefined,
  };
}

function parseChat(payload: unknown, model: string): Omit<AIProviderResponse, "apiMode"> {
  const root = payload as {
    model?: string;
    choices?: Array<{ message?: { content?: string | null; tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }> } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  };
  const message = root.choices?.[0]?.message;
  const toolCalls = (message?.tool_calls ?? []).map((call, index) => ({
    id: String(call.id ?? `call_${index}`),
    name: String(call.function?.name ?? ""),
    arguments: String(call.function?.arguments ?? "{}"),
  }));
  return {
    text: message?.content ?? "",
    toolCalls,
    assistantItem: toolCalls.length ? { type: "assistant_tool_calls", calls: toolCalls } : null,
    model: root.model ?? model,
    usage: root.usage ? { inputTokens: root.usage.prompt_tokens, outputTokens: root.usage.completion_tokens, totalTokens: root.usage.total_tokens } : undefined,
  };
}

function buildBody(mode: ConcreteMode, request: AIProviderRequest, stream: boolean) {
  const common = { model: request.model, stream, store: false };
  if (mode === "responses") {
    return {
      ...common,
      instructions: request.instructions,
      input: responsesInput(request.input),
      include: ["reasoning.encrypted_content"],
      max_output_tokens: request.maxOutputTokens ?? 1_600,
      tools: request.tools?.map((tool) => ({ type: "function", name: tool.name, description: tool.description, parameters: tool.parameters, strict: true })),
      tool_choice: request.tools?.length ? "auto" : undefined,
      parallel_tool_calls: true,
      text: request.responseSchema ? { format: { type: "json_schema", name: request.responseSchema.name, schema: request.responseSchema.schema, strict: true } } : undefined,
    };
  }
  return {
    ...common,
    messages: chatMessages(request.instructions, request.input),
    max_completion_tokens: request.maxOutputTokens ?? 1_600,
    tools: request.tools?.map((tool) => ({ type: "function", function: { name: tool.name, description: tool.description, parameters: tool.parameters, strict: true } })),
    tool_choice: request.tools?.length ? "auto" : undefined,
    parallel_tool_calls: true,
    response_format: request.responseSchema ? { type: "json_schema", json_schema: { name: request.responseSchema.name, schema: request.responseSchema.schema, strict: true } } : undefined,
    stream_options: stream ? { include_usage: true } : undefined,
  };
}

function safeJSON(value: string) {
  try { return JSON.parse(value) as unknown; } catch { return null; }
}

export class OpenAICompatibleProvider implements AIProvider {
  private resolvedMode: ConcreteMode | null = null;

  constructor(private readonly config: AIConfig) {}

  private async fetch(mode: ConcreteMode, request: AIProviderRequest, stream: boolean) {
    if (!this.config.configured) throw new AIProviderError("AI 服务尚未配置", "AI_NOT_CONFIGURED");
    const path = mode === "responses" ? "/responses" : "/chat/completions";
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await fetch(`${this.config.baseUrl}${path}`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.config.apiKey}` },
          body: JSON.stringify(buildBody(mode, request, stream)),
          signal: combineSignal(this.config.timeoutMs, request.signal),
          cache: "no-store",
        });
        if (response.ok) return response;
        const payload = safeJSON(await response.text());
        const unsupported = isUnsupported(response.status, payload);
        const retryable = isRetryableStatus(response.status);
        const providerError = new AIProviderError(errorMessage(payload, `AI 服务请求失败 (${response.status})`), errorCode(payload), response.status, retryable, unsupported);
        if (retryable && attempt === 0) continue;
        throw providerError;
      } catch (error) {
        if (error instanceof AIProviderError) throw error;
        if (request.signal?.aborted) throw new AIProviderError("AI 请求已取消", "AI_CANCELLED");
        if (attempt === 0) continue;
        const timeout = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
        throw new AIProviderError(timeout ? "AI 服务响应超时" : "无法连接 AI 服务", timeout ? "AI_TIMEOUT" : "AI_NETWORK_ERROR", undefined, true);
      }
    }
    throw new AIProviderError("无法连接 AI 服务", "AI_NETWORK_ERROR", undefined, true);
  }

  private preferredModes(): ConcreteMode[] {
    if (this.config.apiMode !== "auto") return [this.config.apiMode];
    return this.resolvedMode ? [this.resolvedMode] : ["responses", "chat"];
  }

  private async withMode<T>(handler: (mode: ConcreteMode) => Promise<T>) {
    const modes = this.preferredModes();
    for (let index = 0; index < modes.length; index += 1) {
      const mode = modes[index];
      try {
        const result = await handler(mode);
        if (this.config.apiMode === "auto") this.resolvedMode = mode;
        return result;
      } catch (error) {
        const canFallback = this.config.apiMode === "auto" && index < modes.length - 1
          && error instanceof AIProviderError && error.endpointUnsupported;
        if (!canFallback) throw error;
      }
    }
    throw new AIProviderError("AI 接口不可用", "AI_ENDPOINT_UNAVAILABLE");
  }

  async generate(request: AIProviderRequest): Promise<AIProviderResponse> {
    return this.withMode(async (mode) => {
      const response = await this.fetch(mode, request, false);
      const payload = await response.json() as unknown;
      return { ...(mode === "responses" ? parseResponses(payload, request.model) : parseChat(payload, request.model)), apiMode: mode };
    });
  }

  async stream(request: AIProviderRequest, onEvent?: (event: AIStreamEvent) => void): Promise<AIProviderResponse> {
    try {
      return await this.withMode(async (mode) => {
      const response = await this.fetch(mode, request, true);
      onEvent?.({ type: "transport_ready", apiMode: mode });
      if (!response.body) throw new AIProviderError("AI 流式响应为空", "AI_EMPTY_STREAM");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let completedPayload: unknown = null;
      let chatText = "";
      const chatCalls = new Map<number, AIToolCall>();
      let chatModel = request.model;
      let chatUsage: AIProviderResponse["usage"];

      const consume = (raw: string) => {
        if (!raw.startsWith("data:")) return;
        const data = raw.slice(5).trim();
        if (!data || data === "[DONE]") return;
        const event = safeJSON(data) as {
          type?: string;
          delta?: string;
          response?: unknown;
          item?: unknown;
          model?: string;
          choices?: Array<{ delta?: { content?: string; tool_calls?: Array<{ index?: number; id?: string; function?: { name?: string; arguments?: string } }> } }>;
          usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
        } | null;
        if (!event) return;
        if (event.type === "response.completed") completedPayload = event.response;
        if (event.type === "response.output_text.delta" && event.delta) onEvent?.({ type: "text_delta", delta: event.delta });
        if (event.type === "response.output_item.done" && event.item && completedPayload === null) {
          const partial = completedPayload as { output?: unknown[] } | null;
          completedPayload = { ...(partial ?? {}), output: [...(partial?.output ?? []), event.item] };
        }
        chatModel = event.model ?? chatModel;
        const delta = event.choices?.[0]?.delta;
        if (delta?.content) { chatText += delta.content; onEvent?.({ type: "text_delta", delta: delta.content }); }
        for (const call of delta?.tool_calls ?? []) {
          const index = call.index ?? 0;
          const current = chatCalls.get(index) ?? { id: call.id ?? `call_${index}`, name: "", arguments: "" };
          if (call.id) current.id = call.id;
          current.name += call.function?.name ?? "";
          current.arguments += call.function?.arguments ?? "";
          chatCalls.set(index, current);
        }
        if (event.usage) chatUsage = { inputTokens: event.usage.prompt_tokens, outputTokens: event.usage.completion_tokens, totalTokens: event.usage.total_tokens };
      };

      while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? "";
        for (const line of lines) consume(line);
        if (done) break;
      }
      if (buffer) consume(buffer);
      if (mode === "responses") {
        if (!completedPayload) throw new AIProviderError("AI 流式响应未正常结束", "AI_INCOMPLETE_STREAM");
        return { ...parseResponses(completedPayload, request.model), apiMode: mode };
      }
      const toolCalls = [...chatCalls.values()];
      return {
        text: chatText,
        toolCalls,
        assistantItem: toolCalls.length ? { type: "assistant_tool_calls", calls: toolCalls } : null,
        apiMode: mode,
        model: chatModel,
        usage: chatUsage,
      };
      });
    } catch (error) {
      if (error instanceof AIProviderError) throw error;
      if (request.signal?.aborted) throw new AIProviderError("AI 请求已取消", "AI_CANCELLED");
      const timeout = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
      throw new AIProviderError(timeout ? "AI 服务响应超时" : "AI 流式连接中断", timeout ? "AI_TIMEOUT" : "AI_NETWORK_ERROR", undefined, true);
    }
  }

  async healthCheck(signal?: AbortSignal): Promise<AIHealthResult> {
    const started = Date.now();
    try {
      const response = await this.generate({ model: this.config.fastModel, instructions: "Reply with OK only.", input: [{ type: "message", role: "user", content: "ping" }], maxOutputTokens: 16, signal });
      return { ok: true, provider: this.config.provider, model: response.model, apiMode: response.apiMode, latencyMs: Date.now() - started };
    } catch (error) {
      return { ok: false, provider: this.config.provider, model: this.config.fastModel, apiMode: this.resolvedMode, latencyMs: Date.now() - started, errorCode: error instanceof AIProviderError ? error.code : "UNKNOWN" };
    }
  }
}
