import { runAI } from "@/ai/orchestrator";
import { beginAIRun, finishActiveAIRun } from "@/ai/run-registry";
import { AIRateLimitError, assertAIRateLimit } from "@/ai/rate-limit";
import type { AIPageContext } from "@/ai/tools/types";
import { getCompanyScope, getSession } from "@/lib/auth";
import { can } from "@/lib/permissions";

export const dynamic = "force-dynamic";

function sse(type: string, data: unknown) {
  return `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
}

function parsePageContext(value: unknown): AIPageContext {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const source = value as Record<string, unknown>;
  const context: AIPageContext = {};
  for (const key of ["pathname", "pageType"] as const) if (typeof source[key] === "string") context[key] = source[key].slice(0, 200);
  for (const key of ["projectId", "supplierId", "customerId", "purchaseRequestId", "paymentRequestId"] as const) {
    const id = Number(source[key]);
    if (Number.isInteger(id) && id > 0) context[key] = id;
  }
  return context;
}

function publicError(error: unknown) {
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "AI_RUN_FAILED";
  if (code === "AI_CANCELLED") return { code, message: "本次分析已取消" };
  if (code === "AI_NOT_CONFIGURED") return { code, message: "AI 服务尚未配置，请联系系统管理员" };
  if (code === "AI_TIMEOUT") return { code, message: "AI 服务响应超时，请稍后重试" };
  return { code, message: "AI 分析暂时不可用，请稍后重试" };
}

export async function POST(request: Request) {
  const user = await getSession();
  if (!user) return Response.json({ error: "请先登录" }, { status: 401 });
  if (!can(user, "ai")) return Response.json({ error: "无权使用 AI 查询" }, { status: 403 });

  let body: { question?: unknown; conversationId?: unknown; pageContext?: unknown };
  try { body = await request.json() as typeof body; }
  catch { return Response.json({ error: "请求格式无效" }, { status: 400 }); }
  const question = String(body.question ?? "").trim().slice(0, 2_000);
  if (!question) return Response.json({ error: "请输入问题" }, { status: 400 });
  try { await assertAIRateLimit(user); }
  catch (error) {
    if (error instanceof AIRateLimitError) return Response.json({ error: error.message, code: error.code }, { status: 429, headers: { "Retry-After": String(error.retryAfterSeconds) } });
    throw error;
  }
  const active = beginAIRun(user.id);
  if (!active) return Response.json({ error: "已有一项 AI 分析正在运行，请先等待或取消" }, { status: 409 });
  const conversationId = Number(body.conversationId);
  const scope = await getCompanyScope(user);
  const encoder = new TextEncoder();
  const disconnect = () => active.controller.abort();
  request.signal.addEventListener("abort", disconnect, { once: true });

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (type: string, data: unknown) => controller.enqueue(encoder.encode(sse(type, data)));
      void runAI({
        question,
        conversationId: Number.isInteger(conversationId) && conversationId > 0 ? conversationId : undefined,
        user,
        companyScope: scope,
        pageContext: parsePageContext(body.pageContext),
        signal: active.controller.signal,
        onStatus: (message) => send("status", { message }),
      }).then((result) => send("final", result)).catch((error) => send("error", publicError(error))).finally(() => {
        request.signal.removeEventListener("abort", disconnect);
        finishActiveAIRun(user.id, active.controller);
        controller.close();
      });
    },
    cancel() { active.controller.abort(); finishActiveAIRun(user.id, active.controller); },
  });

  return new Response(stream, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" } });
}
