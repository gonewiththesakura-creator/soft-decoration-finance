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
  const detail = pathname.match(/^\/(projects|suppliers|customers|purchase-requests|payment-requests|purchase-orders|receivables|payables|payments|invoices)\/(\d+)/);
  if (detail) {
    const id = Number(detail[2]);
    const detailContexts: Record<string, AIPageContext> = {
      projects: { pageType: "project", projectId: id },
      suppliers: { pageType: "supplier", supplierId: id },
      customers: { pageType: "customer", customerId: id },
      "purchase-requests": { pageType: "purchase_request", purchaseRequestId: id },
      "payment-requests": { pageType: "payment_request", paymentRequestId: id },
      "purchase-orders": { pageType: "purchase_order", purchaseOrderId: id },
      receivables: { pageType: "receivable", receivableId: id },
      payables: { pageType: "payable", payableId: id },
      payments: { pageType: "payment", paymentId: id },
      invoices: { pageType: "invoice", invoiceId: id },
    };
    return { ...context, ...detailContexts[detail[1]] };
  }

  const pageTypes: Record<string, string> = {
    "/dashboard": "dashboard",
    "/finance-workspace": "finance_workspace",
    "/procurement-workspace": "procurement_workspace",
    "/projects": "projects",
    "/suppliers": "suppliers",
    "/customers": "customers",
    "/payment-requests": "payment_requests",
    "/purchase-requests": "purchase_requests",
    "/purchase-orders": "purchase_orders",
    "/receivables": "receivables",
    "/payables": "payables",
    "/payments": "payments",
    "/receipts": "receipts",
    "/invoices": "invoices",
    "/imports": "imports",
    "/ai": "ai_workspace",
  };
  const matchedPath = Object.keys(pageTypes).find((candidate) => pathname === candidate || pathname.startsWith(`${candidate}/`));
  return matchedPath ? { ...context, pageType: pageTypes[matchedPath] } : context;
}

const contextLabels: Record<string, string> = {
  "/dashboard": "经营总览",
  "/finance-workspace": "财务工作台",
  "/procurement-workspace": "采购工作台",
  "/projects": "项目中心",
  "/suppliers": "供应商",
  "/customers": "客户",
  "/payment-requests": "付款申请",
  "/purchase-requests": "采购申请",
  "/purchase-orders": "采购订单",
  "/receivables": "应收计划",
  "/payables": "供应商应付",
  "/payments": "付款记录",
  "/receipts": "收款记录",
  "/invoices": "发票台账",
  "/imports": "数据迁移中心",
  "/ai": "AI 工作台",
};

export function contextLabelFromPathname(pathname: string, visibleEntityName?: string | null) {
  if (/^\/(projects|suppliers|customers|purchase-requests|payment-requests|purchase-orders|receivables|payables|payments|invoices)\/\d+/.test(pathname) && visibleEntityName?.trim()) {
    return visibleEntityName.trim();
  }
  const matchedPath = Object.keys(contextLabels).find((candidate) => pathname === candidate || pathname.startsWith(`${candidate}/`));
  return matchedPath ? contextLabels[matchedPath] : "当前业务页面";
}
