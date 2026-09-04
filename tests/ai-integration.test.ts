import { describe, expect, it } from "vitest";
import { runAI } from "@/ai/orchestrator";
import { MockAIProvider } from "@/ai/providers/mock";
import { AIProviderError } from "@/ai/providers/openai-compatible";
import type { AIProviderResponse } from "@/ai/providers/types";
import { executeAITool } from "@/ai/tools/registry";
import { sqlQuery } from "@/db/client";
import type { SessionUser } from "@/lib/auth";

const owner: SessionUser = { id: 1, companyId: null, name: "陈屿", email: "owner@zhiheng.local", role: "owner" };

function providerResponse(value: Partial<AIProviderResponse>): AIProviderResponse {
  return { text: "", toolCalls: [], assistantItem: null, apiMode: "responses", model: "mock-primary", usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 }, ...value };
}

const finalPayload = {
  summary: "项目采购进度需要关注。",
  severity: "warning",
  metrics: [{ label: "采购状态", value: "已读取", tone: "info" }],
  findings: [{ title: "存在待处理项", detail: "依据项目摘要核查。", severity: "warning" }],
  evidence: [],
  recommendations: [{ title: "人工复核", detail: "进入项目页面核对采购节点。", priority: "medium" }],
  suggestedActions: [{ label: "查看项目", description: "打开项目总账", href: "/projects/1", kind: "link" }],
  degraded: false,
  notice: "结论只读，不会修改业务数据。",
};

describe.sequential("AI core integration", () => {
  it("runs a model-selected business tool and records the complete audit chain", async () => {
    const [project] = await sqlQuery<{ id: number }>("SELECT id FROM projects ORDER BY id LIMIT 1");
    const call = { id: "call_project", name: "get_project_summary", arguments: JSON.stringify({ projectId: project.id }) };
    const provider = new MockAIProvider([
      providerResponse({ toolCalls: [call], assistantItem: { type: "assistant_tool_calls", calls: [call] } }),
      providerResponse({ text: JSON.stringify({ ...finalPayload, evidence: [{ label: "模型猜测", value: "¥999,999.00", href: "/projects" }], suggestedActions: [{ ...finalPayload.suggestedActions[0], href: `/projects/${project.id}` }, { label: "外部链接", description: "不可信链接", href: "https://example.test/", kind: "link" }] }) }),
    ]);
    const result = await runAI({ question: "这个项目现在最需要关注什么？", user: owner, companyScope: null, pageContext: { pageType: "project", projectId: project.id }, provider });
    expect(result.response.degraded).toBe(false);
    expect(result.response.evidence.some((item) => item.href === `/projects/${project.id}`)).toBe(true);
    expect(result.response.evidence.some((item) => item.label === "模型猜测")).toBe(false);
    expect(result.response.suggestedActions.find((item) => item.label === "外部链接")).toMatchObject({ href: "", kind: "draft" });
    expect(provider.requests).toHaveLength(2);
    expect(provider.requests[1].tools).toBeUndefined();
    expect(provider.requests[1].model).toBe(process.env.AI_MODEL_FAST || "gpt-5.4-mini");
    expect(provider.requests[1].input.some((item) => item.type === "message" && item.content.includes("授权只读业务工具结果"))).toBe(true);
    const [audit] = await sqlQuery<{ runs: number; calls: number; messages: number }>(`SELECT (SELECT count(*)::int FROM ai_runs WHERE conversation_id=$1 AND status='completed') AS runs,(SELECT count(*)::int FROM ai_tool_calls tc JOIN ai_runs r ON r.id=tc.ai_run_id WHERE r.conversation_id=$1 AND tc.tool_name='get_project_summary' AND tc.success) AS calls,(SELECT count(*)::int FROM ai_messages WHERE conversation_id=$1) AS messages`, [result.conversationId]);
    expect(audit).toEqual({ runs: 1, calls: 1, messages: 2 });
  });

  it("uses the fast model to repair invalid final JSON", async () => {
    const provider = new MockAIProvider([
      providerResponse({ text: "not-json" }),
      providerResponse({ text: JSON.stringify(finalPayload), model: "mock-fast" }),
    ]);
    const result = await runAI({ question: "给我一个不涉及金额的经营分析框架", user: owner, companyScope: null, pageContext: { pageType: "ai_workspace" }, provider });
    expect(result.response.summary).toBe(finalPayload.summary);
    expect(provider.requests[1].model).toBe(process.env.AI_MODEL_FAST || "gpt-5.4-mini");
  });

  it("uses the primary model only when fast synthesis has a retryable outage", async () => {
    const [project] = await sqlQuery<{ id: number }>("SELECT id FROM projects ORDER BY id LIMIT 1");
    const call = { id: "call_project_retry", name: "get_project_summary", arguments: JSON.stringify({ projectId: project.id }) };
    const provider = new MockAIProvider([
      providerResponse({ toolCalls: [call], assistantItem: { type: "assistant_tool_calls", calls: [call] } }),
      new AIProviderError("temporarily unavailable", "API_ERROR", 503, true),
      providerResponse({ text: JSON.stringify({ ...finalPayload, degraded: true }), model: "mock-primary" }),
    ]);
    const result = await runAI({ question: "分析项目经营情况", user: owner, companyScope: null, pageContext: { pageType: "project", projectId: project.id }, provider });
    expect(result.response.degraded).toBe(false);
    expect(provider.requests.map((item) => item.model)).toEqual([
      process.env.AI_MODEL_PRIMARY || "gpt-5.6-sol",
      process.env.AI_MODEL_FAST || "gpt-5.4-mini",
      process.env.AI_MODEL_PRIMARY || "gpt-5.6-sol",
    ]);
  });

  it("blocks project data outside a designer's memberships", async () => {
    const [designer] = await sqlQuery<{ id: number; companyId: number; name: string; email: string }>("SELECT id,company_id AS \"companyId\",name,email FROM users WHERE role='designer' AND company_id=1 LIMIT 1");
    const [foreignProject] = await sqlQuery<{ id: number }>("SELECT p.id FROM projects p WHERE p.company_id<>$1 ORDER BY p.id LIMIT 1", [designer.companyId]);
    await expect(executeAITool("get_project_summary", { projectId: foreignProject.id }, { user: { ...designer, role: "designer" }, companyScope: designer.companyId, pageContext: {} })).rejects.toThrow("项目不存在或无权查看");
  });

  it("returns deterministic payable and missing-invoice aggregates", async () => {
    const result = await executeAITool("get_upcoming_payables", { days: 7 }, { user: owner, companyScope: null, pageContext: {} });
    const data = result.data as {
      totalCents: number;
      rowCount: number;
      rows: Array<{ amountCents: number }>;
      invoiceStatusTotals: Array<{ invoiceStatus: string; rowCount: number; totalCents: number }>;
      missingInvoiceCount: number;
      missingInvoiceTotalCents: number;
      largestMissingInvoiceRows: Array<{ amountCents: number; invoiceStatus: string }>;
      largestMissingInvoiceTotalCents: number;
    };
    const missingStatus = data.invoiceStatusTotals.find((item) => item.invoiceStatus === "欠票");
    expect(data.rowCount).toBeGreaterThanOrEqual(data.rows.length);
    expect(data.missingInvoiceCount).toBe(missingStatus?.rowCount ?? 0);
    expect(data.missingInvoiceTotalCents).toBe(missingStatus?.totalCents ?? 0);
    expect(data.largestMissingInvoiceRows).toHaveLength(Math.min(3, data.missingInvoiceCount));
    expect(data.largestMissingInvoiceRows.every((row) => row.invoiceStatus === "欠票")).toBe(true);
    expect(data.largestMissingInvoiceTotalCents).toBe(data.largestMissingInvoiceRows.reduce((sum, row) => sum + row.amountCents, 0));
    expect(data.largestMissingInvoiceRows.map((row) => row.amountCents)).toEqual(
      [...data.largestMissingInvoiceRows].sort((left, right) => right.amountCents - left.amountCents).map((row) => row.amountCents),
    );
  });

  it("returns exact pending approval counts and amounts for the dashboard", async () => {
    const result = await executeAITool("get_dashboard_brief", {}, { user: owner, companyScope: null, pageContext: {} });
    const data = result.data as { summary: { pendingPurchases: number; pendingPurchaseCents: number; pendingPayments: number; pendingPaymentCents: number }; recentPendingSamples: unknown[] };
    expect(data.summary.pendingPurchases).toBeGreaterThanOrEqual(0);
    expect(data.summary.pendingPurchaseCents).toBeGreaterThanOrEqual(0);
    expect(data.summary.pendingPayments).toBeGreaterThanOrEqual(0);
    expect(data.summary.pendingPaymentCents).toBeGreaterThanOrEqual(0);
    expect(data.recentPendingSamples.length).toBeLessThanOrEqual(8);
  });
});
