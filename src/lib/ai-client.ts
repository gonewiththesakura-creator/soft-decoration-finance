import type { AIStructuredResponse } from "@/ai/response";
import type { AIPageContext } from "@/ai/tools/types";

export type AIClientResult = { conversationId: number; response: AIStructuredResponse };

export async function requestAI(input: { question: string; conversationId?: number | null; pageContext?: AIPageContext; signal?: AbortSignal; onStatus?: (message: string) => void }) {
  const response = await fetch("/api/ai", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question: input.question, conversationId: input.conversationId, pageContext: input.pageContext }),
    signal: input.signal,
  });
  if (!response.ok || !response.body) {
    const payload = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(payload.error ?? "AI 分析请求失败");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const state: { result?: AIClientResult; streamError?: string } = {};

  const consume = (block: string) => {
    const event = block.split(/\r?\n/).find((line) => line.startsWith("event:"))?.slice(6).trim();
    const data = block.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("\n");
    if (!event || !data) return;
    const payload = JSON.parse(data) as { message?: string } | AIClientResult;
    if (event === "status") input.onStatus?.((payload as { message?: string }).message ?? "正在分析...");
    if (event === "final") state.result = payload as AIClientResult;
    if (event === "error") state.streamError = (payload as { message?: string }).message ?? "AI 分析失败";
  };

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() ?? "";
    for (const block of blocks) consume(block);
    if (done) break;
  }
  if (buffer.trim()) consume(buffer);
  if (state.streamError) throw new Error(state.streamError);
  if (!state.result) throw new Error("AI 响应未正常结束");
  return state.result;
}

export function contextFromPathname(pathname: string): AIPageContext {
  const context: AIPageContext = { pathname };
  const match = pathname.match(/^\/(projects|suppliers|customers)\/(\d+)/);
  if (!match) return context;
  const id = Number(match[2]);
  if (match[1] === "projects") return { ...context, pageType: "project", projectId: id };
  if (match[1] === "suppliers") return { ...context, pageType: "supplier", supplierId: id };
  return { ...context, pageType: "customer", customerId: id };
}
