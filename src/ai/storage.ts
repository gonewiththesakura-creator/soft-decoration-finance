import { sqlQuery } from "@/db/client";
import type { SessionUser } from "@/lib/auth";
import type { AIConversationItem, AIProviderResponse } from "./providers/types";
import type { AIStructuredResponse } from "./response";
import type { AIPageContext } from "./tools/types";

export type AIConversationRecord = { id: number; title: string; pageContext: AIPageContext; createdAt: string; updatedAt: string };

export async function createConversation(user: SessionUser, companyId: number | null, title: string, pageContext: AIPageContext) {
  const [row] = await sqlQuery<AIConversationRecord>(`INSERT INTO ai_conversations(user_id,company_id,title,page_context) VALUES($1,$2,$3,$4::jsonb) RETURNING id,title,page_context AS "pageContext",created_at::text AS "createdAt",updated_at::text AS "updatedAt"`, [user.id, companyId, title.slice(0, 60) || "新对话", JSON.stringify(pageContext)]);
  return row;
}
export async function assertConversation(conversationId: number, user: SessionUser, companyId: number | null) {
  const params: unknown[] = [conversationId, user.id];
  const checks = ["id=$1", "user_id=$2"];
  if (companyId !== null) { params.push(companyId); checks.push(`company_id=$${params.length}`); }
  const [row] = await sqlQuery<AIConversationRecord>(`SELECT id,title,page_context AS "pageContext",created_at::text AS "createdAt",updated_at::text AS "updatedAt" FROM ai_conversations WHERE ${checks.join(" AND ")}`, params);
  if (!row) throw new Error("对话不存在或无权访问");
  return row;
}

export async function listConversations(user: SessionUser, companyId: number | null) {
  const params: unknown[] = [user.id];
  const companyClause = companyId === null ? "TRUE" : (params.push(companyId), `company_id=$${params.length}`);
  return sqlQuery<AIConversationRecord & { messageCount: number }>(`SELECT c.id,c.title,c.page_context AS "pageContext",c.created_at::text AS "createdAt",c.updated_at::text AS "updatedAt",count(m.id)::int AS "messageCount" FROM ai_conversations c LEFT JOIN ai_messages m ON m.conversation_id=c.id WHERE c.user_id=$1 AND ${companyClause} GROUP BY c.id ORDER BY c.updated_at DESC LIMIT 40`, params);
}

export async function loadMessages(conversationId: number) {
  return sqlQuery<{ id: number; role: "user" | "assistant"; content: string; structuredResponse: AIStructuredResponse | null; createdAt: string }>(`SELECT id,role,content,structured_response AS "structuredResponse",created_at::text AS "createdAt" FROM ai_messages WHERE conversation_id=$1 ORDER BY created_at,id`, [conversationId]);
}

export async function conversationItems(conversationId: number): Promise<AIConversationItem[]> {
  const messages = await loadMessages(conversationId);
  return messages.slice(-20).map((message) => ({ type: "message", role: message.role, content: message.structuredResponse ? JSON.stringify(message.structuredResponse) : message.content }));
}

export async function saveMessage(conversationId: number, role: "user" | "assistant", content: string, structuredResponse?: AIStructuredResponse) {
  const [message] = await sqlQuery<{ id: number }>(`INSERT INTO ai_messages(conversation_id,role,content,structured_response) VALUES($1,$2,$3,$4::jsonb) RETURNING id`, [conversationId, role, content, structuredResponse ? JSON.stringify(structuredResponse) : null]);
  await sqlQuery(`UPDATE ai_conversations SET updated_at=now() WHERE id=$1`, [conversationId]);
  return message.id;
}

export async function startRun(conversationId: number, user: SessionUser, companyId: number | null, provider: string, model: string) {
  const [row] = await sqlQuery<{ id: number }>(`INSERT INTO ai_runs(conversation_id,user_id,company_id,provider,model,status) VALUES($1,$2,$3,$4,$5,'running') RETURNING id`, [conversationId, user.id, companyId, provider, model]);
  return row.id;
}

export async function finishRun(runId: number, status: "completed" | "failed" | "cancelled" | "degraded", startedAt: number, response?: AIProviderResponse, errorCode?: string) {
  await sqlQuery(`UPDATE ai_runs SET status=$1,api_mode=$2,model=COALESCE($3,model),input_tokens=$4,output_tokens=$5,total_tokens=$6,latency_ms=$7,error_code=$8,finished_at=now() WHERE id=$9`, [status, response?.apiMode ?? null, response?.model ?? null, response?.usage?.inputTokens ?? null, response?.usage?.outputTokens ?? null, response?.usage?.totalTokens ?? null, Date.now() - startedAt, errorCode ?? null, runId]);
}

export async function logToolCall(runId: number, name: string, args: Record<string, unknown>, resultSummary: string, durationMs: number, success: boolean) {
  await sqlQuery(`INSERT INTO ai_tool_calls(ai_run_id,tool_name,arguments,result_summary,duration_ms,success) VALUES($1,$2,$3::jsonb,$4,$5,$6)`, [runId, name, JSON.stringify(args).slice(0, 4_000), resultSummary.slice(0, 500), durationMs, success]);
}
