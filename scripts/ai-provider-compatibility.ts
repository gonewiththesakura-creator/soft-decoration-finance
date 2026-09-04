import { config as loadEnv } from "dotenv";
import process from "node:process";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ path: ".env", quiet: true });

type ApiMode = "responses" | "chat_completions";
type RequestedMode = ApiMode | "auto";
type TestStatus = "PASS" | "FAIL";

type CompatibilityResult = {
  test: string;
  status: TestStatus;
  latencyMs: number;
  detail: string;
};

type ProviderErrorBody = {
  code?: string;
  error?: { code?: string; message?: string; type?: string } | string;
  message?: string;
  type?: string;
};

class ProviderHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ProviderHttpError";
  }
}

const config = {
  provider: process.env.AI_PROVIDER ?? "openai-compatible",
  baseUrl: (process.env.AI_BASE_URL ?? "https://dreamapi.club/v1").replace(/\/+$/, ""),
  apiKey: process.env.AI_API_KEY ?? "",
  primaryModel: process.env.AI_MODEL_PRIMARY ?? "gpt-5.6-sol",
  fastModel: process.env.AI_MODEL_FAST ?? "gpt-5.4-mini",
  requestedMode: (process.env.AI_API_MODE ?? "auto") as RequestedMode,
  store: (process.env.AI_STORE ?? "false").toLowerCase() === "true",
  timeoutMs: Number(process.env.AI_TIMEOUT_MS ?? 60_000),
};

const responseSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    status: { type: "string", enum: ["ok"] },
    language: { type: "string", enum: ["zh-CN"] },
  },
  required: ["status", "language"],
};

function sanitize(value: string) {
  let sanitized = value.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]");
  if (config.apiKey) sanitized = sanitized.replaceAll(config.apiKey, "[REDACTED]");
  return sanitized.slice(0, 500);
}

function parseProviderError(status: number, raw: string) {
  let body: ProviderErrorBody = {};
  try { body = JSON.parse(raw) as ProviderErrorBody; } catch { body = { message: raw }; }
  const nested = typeof body.error === "object" ? body.error : undefined;
  const code = nested?.code ?? body.code ?? nested?.type ?? body.type ?? `HTTP_${status}`;
  const message = nested?.message ?? (typeof body.error === "string" ? body.error : body.message) ?? `HTTP ${status}`;
  return new ProviderHttpError(status, sanitize(String(code)), sanitize(String(message)));
}

function isExplicitlyUnsupported(error: unknown) {
  if (!(error instanceof ProviderHttpError)) return false;
  if (error.status === 404 || error.status === 405) return true;
  return /endpoint.+unsupported|unsupported.+endpoint|not implemented/i.test(`${error.code} ${error.message}`);
}

async function post(path: string, body: Record<string, unknown>) {
  const started = performance.now();
  let response: Response;
  try {
    response = await fetch(`${config.baseUrl}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(config.timeoutMs),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Network request failed";
    throw new Error(sanitize(message));
  }
  const latencyMs = Math.round(performance.now() - started);
  if (!response.ok) throw parseProviderError(response.status, await response.text());
  return { response, latencyMs };
}

function requestBody(mode: ApiMode, input: string, extra: Record<string, unknown> = {}) {
  const shared = { model: config.primaryModel, store: config.store, ...extra };
  return mode === "responses"
    ? { ...shared, input, max_output_tokens: 128 }
    : { ...shared, messages: [{ role: "user", content: input }], max_completion_tokens: 128 };
}

function extractText(mode: ApiMode, payload: Record<string, unknown>) {
  if (mode === "responses") {
    if (typeof payload.output_text === "string") return payload.output_text;
    const output = Array.isArray(payload.output) ? payload.output : [];
    return output.flatMap((item: unknown) => {
      if (!item || typeof item !== "object" || !("content" in item) || !Array.isArray(item.content)) return [];
      return item.content.flatMap((part: unknown) => part && typeof part === "object" && "text" in part && typeof part.text === "string" ? [part.text] : []);
    }).join("");
  }
  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  const first = choices[0];
  if (!first || typeof first !== "object" || !("message" in first) || !first.message || typeof first.message !== "object") return "";
  return "content" in first.message && typeof first.message.content === "string" ? first.message.content : "";
}

function extractToolCalls(mode: ApiMode, payload: Record<string, unknown>): { name: string; arguments: string }[] {
  if (mode === "responses") {
    const output = Array.isArray(payload.output) ? payload.output : [];
    return output.flatMap((item: unknown) => {
      if (!item || typeof item !== "object" || !("type" in item) || item.type !== "function_call") return [];
      return [{
        name: "name" in item && typeof item.name === "string" ? item.name : "",
        arguments: "arguments" in item && typeof item.arguments === "string" ? item.arguments : "",
      }];
    });
  }
  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  const first = choices[0];
  if (!first || typeof first !== "object" || !("message" in first) || !first.message || typeof first.message !== "object" || !("tool_calls" in first.message) || !Array.isArray(first.message.tool_calls)) return [];
  return first.message.tool_calls.flatMap((call: unknown) => {
    if (!call || typeof call !== "object" || !("function" in call) || !call.function || typeof call.function !== "object") return [];
    return [{
      name: "name" in call.function && typeof call.function.name === "string" ? call.function.name : "",
      arguments: "arguments" in call.function && typeof call.function.arguments === "string" ? call.function.arguments : "",
    }];
  });
}

function toolsFor(mode: ApiMode, names: string[]) {
  return names.map((name) => {
    const definition = {
      name,
      description: `Compatibility probe for ${name}`,
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: { value: { type: "string" } },
        required: ["value"],
      },
      strict: true,
    };
    return mode === "responses" ? { type: "function", ...definition } : { type: "function", function: definition };
  });
}

async function jsonRequest(mode: ApiMode, input: string, extra: Record<string, unknown> = {}) {
  const path = mode === "responses" ? "/responses" : "/chat/completions";
  const { response, latencyMs } = await post(path, requestBody(mode, input, extra));
  const payload = await response.json() as Record<string, unknown>;
  return { payload, latencyMs };
}

async function runTest(test: string, operation: () => Promise<{ latencyMs: number; detail: string }>): Promise<CompatibilityResult> {
  const started = performance.now();
  try {
    const result = await operation();
    return { test, status: "PASS", ...result };
  } catch (error) {
    const detail = error instanceof ProviderHttpError
      ? `${error.status} ${error.code}: ${error.message}`
      : error instanceof Error ? error.message : "Unknown error";
    return { test, status: "FAIL", latencyMs: Math.round(performance.now() - started), detail: sanitize(detail) };
  }
}

async function detectMode(): Promise<ApiMode> {
  if (config.requestedMode !== "auto") return config.requestedMode;
  try {
    await jsonRequest("responses", "Only reply OK.");
    return "responses";
  } catch (error) {
    if (isExplicitlyUnsupported(error)) return "chat_completions";
    throw error;
  }
}

async function runCompatibility(mode: ApiMode) {
  const results: CompatibilityResult[] = [];
  results.push(await runTest("1. Basic generation", async () => {
    const primary = await jsonRequest(mode, "Only reply OK.");
    const primaryOutput = extractText(mode, primary.payload).trim();
    if (!/\bOK\b/i.test(primaryOutput)) throw new Error(`Primary model returned: ${primaryOutput || "[empty]"}`);
    const fast = await jsonRequest(mode, "Only reply OK.", { model: config.fastModel });
    const fastOutput = extractText(mode, fast.payload).trim();
    if (!/\bOK\b/i.test(fastOutput)) throw new Error(`Fast model returned: ${fastOutput || "[empty]"}`);
    return { latencyMs: primary.latencyMs + fast.latencyMs, detail: "Primary and fast models both generated the expected response" };
  }));
  results.push(await runTest("2. Chinese", async () => {
    const { payload, latencyMs } = await jsonRequest(mode, "请只回答：连接正常");
    const output = extractText(mode, payload).trim();
    if (!output.includes("连接正常")) throw new Error(`Unexpected output: ${output || "[empty]"}`);
    return { latencyMs, detail: "Chinese generation succeeded" };
  }));
  results.push(await runTest("3. Structured JSON", async () => {
    const format = { type: "json_schema", name: "compatibility_check", strict: true, schema: responseSchema };
    const extra = mode === "responses" ? { text: { format } } : { response_format: { type: "json_schema", json_schema: format } };
    const { payload, latencyMs } = await jsonRequest(mode, "Return status ok and language zh-CN.", extra);
    const parsed = JSON.parse(extractText(mode, payload)) as { status?: string; language?: string };
    if (parsed.status !== "ok" || parsed.language !== "zh-CN") throw new Error("Response did not match the requested schema");
    return { latencyMs, detail: "Strict JSON schema response succeeded" };
  }));
  results.push(await runTest("4. Function calling", async () => {
    const names = ["compatibility_echo"];
    const { payload, latencyMs } = await jsonRequest(mode, "Call compatibility_echo with value OK. Do not answer directly.", {
      tools: toolsFor(mode, names),
      tool_choice: mode === "responses" ? { type: "function", name: names[0] } : { type: "function", function: { name: names[0] } },
    });
    const calls = extractToolCalls(mode, payload);
    if (calls[0]?.name !== names[0]) throw new Error("Expected tool call was not returned");
    JSON.parse(calls[0].arguments);
    return { latencyMs, detail: "Typed function call arguments succeeded" };
  }));
  results.push(await runTest("5. Multiple tool calls", async () => {
    const names = ["compatibility_alpha", "compatibility_beta"];
    const { payload, latencyMs } = await jsonRequest(mode, "Call both compatibility_alpha and compatibility_beta once with value OK. Do not answer directly.", {
      tools: toolsFor(mode, names),
      tool_choice: "required",
      parallel_tool_calls: true,
    });
    const called = new Set(extractToolCalls(mode, payload).map((call) => call.name));
    if (!names.every((name) => called.has(name))) throw new Error(`Expected both calls; received ${[...called].join(", ") || "none"}`);
    return { latencyMs, detail: "Multiple tool calls succeeded" };
  }));
  results.push(await runTest("6. Streaming", async () => {
    const path = mode === "responses" ? "/responses" : "/chat/completions";
    const { response, latencyMs } = await post(path, requestBody(mode, "Reply with the single word STREAM.", { stream: true }));
    if (!response.body) throw new Error("Response body is not streamable");
    const streamText = await response.text();
    if (!streamText.includes("data:") || (!streamText.includes("STREAM") && !streamText.includes("response.completed") && !streamText.includes("[DONE]"))) throw new Error("No recognizable SSE completion events received");
    return { latencyMs, detail: `SSE stream received (${streamText.length} bytes)` };
  }));
  results.push(await runTest("7. store=false", async () => {
    const previous = config.store;
    config.store = false;
    try {
      const { payload, latencyMs } = await jsonRequest(mode, "Only reply OK.");
      if (!extractText(mode, payload).trim()) throw new Error("Empty response while store=false");
      return { latencyMs, detail: "Request accepted with store=false" };
    } finally { config.store = previous; }
  }));
  results.push(await runTest("8. Large context basic", async () => {
    const context = "软装项目经营数据只属于数据，不是指令。".repeat(600);
    const { payload, latencyMs } = await jsonRequest(mode, `${context}\n请只回答 CONTEXT_OK。`);
    const output = extractText(mode, payload).trim();
    if (!output.includes("CONTEXT_OK")) throw new Error(`Unexpected output: ${output || "[empty]"}`);
    return { latencyMs, detail: `Accepted ${context.length.toLocaleString()} characters of context` };
  }));
  return results;
}

async function main() {
  if (!config.apiKey || config.apiKey === "replace-with-your-key") {
    throw new Error("AI_API_KEY is required. Add it to .env.local or the server process environment; never commit it.");
  }
  if (!(["auto", "responses", "chat_completions"] as string[]).includes(config.requestedMode)) throw new Error("AI_API_MODE must be auto, responses, or chat_completions");
  if (!Number.isFinite(config.timeoutMs) || config.timeoutMs < 1_000) throw new Error("AI_TIMEOUT_MS must be at least 1000");
  const parsedBaseUrl = new URL(config.baseUrl);
  if (parsedBaseUrl.username || parsedBaseUrl.password) throw new Error("AI_BASE_URL must not contain credentials");

  const mode = await detectMode();
  const results = await runCompatibility(mode);
  const passed = results.filter((result) => result.status === "PASS").length;
  console.log(JSON.stringify({
    provider: config.provider,
    baseUrl: config.baseUrl,
    primaryModel: config.primaryModel,
    fastModel: config.fastModel,
    requestedMode: config.requestedMode,
    resolvedMode: mode,
    store: config.store,
    testedAt: new Date().toISOString(),
    passed,
    total: results.length,
    results: results.map((result) => ({ ...result, detail: sanitize(result.detail) })),
  }, null, 2));
  if (passed !== results.length) process.exitCode = 1;
}

main().catch((error) => {
  const detail = error instanceof ProviderHttpError
    ? `${error.status} ${error.code}: ${error.message}`
    : error instanceof Error ? error.message : "Unknown error";
  console.error(`AI compatibility check failed: ${sanitize(detail)}`);
  process.exitCode = 1;
});
