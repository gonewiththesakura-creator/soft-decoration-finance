import { getAIConfig } from "@/ai/config";
import { getAIProvider } from "@/ai/providers/provider";
import { sqlQuery } from "@/db/client";
import { getSession } from "@/lib/auth";
import { getAIOperationsStats } from "@/ai/storage";
import { AIRateLimitError, assertAIRateLimit, limitsForUser } from "@/ai/rate-limit";

export async function GET() {
  const user = await getSession();
  if (!user) return Response.json({ error: "请先登录" }, { status: 401 });
  if (user.role !== "owner") return Response.json({ error: "仅老板可查看模型配置" }, { status: 403 });
  const config = getAIConfig();
  const [checks, operations] = await Promise.all([
    sqlQuery<Record<string, unknown>>(`SELECT status,provider,primary_model AS "primaryModel",fast_model AS "fastModel",api_mode AS "apiMode",latency_ms AS "latencyMs",error_code AS "errorCode",created_at::text AS "createdAt" FROM ai_provider_checks ORDER BY created_at DESC LIMIT 10`),
    getAIOperationsStats(),
  ]);
  return Response.json({ configured: config.configured, provider: config.provider, baseUrl: config.baseUrl, primaryModel: config.primaryModel, fastModel: config.fastModel, requestedMode: config.apiMode, store: config.store, timeoutMs: config.timeoutMs, limits: limitsForUser(user), operations, checks });
}

export async function POST() {
  const user = await getSession();
  if (!user) return Response.json({ error: "请先登录" }, { status: 401 });
  if (user.role !== "owner") return Response.json({ error: "仅老板可执行模型连接测试" }, { status: 403 });
  try { await assertAIRateLimit(user); }
  catch (error) {
    if (error instanceof AIRateLimitError) return Response.json({ error: error.message, code: error.code }, { status: 429, headers: { "Retry-After": String(error.retryAfterSeconds) } });
    throw error;
  }
  const config = getAIConfig();
  const result = await getAIProvider().healthCheck();
  await sqlQuery(`INSERT INTO ai_provider_checks(user_id,provider,base_url,primary_model,fast_model,api_mode,status,latency_ms,error_code) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [user.id, config.provider, config.baseUrl, config.primaryModel, config.fastModel, result.apiMode, result.ok ? "passed" : "failed", result.latencyMs, result.errorCode ?? null]);
  return Response.json({ result }, { status: result.ok ? 200 : 503 });
}
