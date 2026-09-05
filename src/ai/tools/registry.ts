import { getDashboardAnalytics } from "@/data/analytics/dashboard";
import { getFinanceAnalytics } from "@/data/analytics/finance";
import { calculateProjectHealth } from "@/data/analytics/health";
import { getProjectAnalytics } from "@/data/analytics/projects";
import { analyticsScope } from "@/data/analytics/scope";
import { getDashboardData } from "@/data/dashboard";
import { getCustomerProfile, getCustomerSections, getSupplierProfile, getSupplierSections } from "@/data/partners";
import { getProjectDetail } from "@/data/project-detail";
import { getPaymentApprovalDetail, getPurchaseApprovalDetail } from "@/data/workflows";
import { sqlQuery } from "@/db/client";
import type { SessionUser } from "@/lib/auth";
import type { AIJSONSchema } from "@/ai/providers/types";
import type { AIPageContext, AIToolContext, AIToolResult, RegisteredAITool } from "./types";
import { customerAIDTO, paymentRequestAIDTO, projectAIDTO, purchaseRequestAIDTO, supplierAIDTO } from "./dto";

const allRoles: SessionUser["role"][] = ["owner", "finance", "procurement", "project_manager", "designer"];
const financeRoles: SessionUser["role"][] = ["owner", "finance"];
const projectFinanceRoles: SessionUser["role"][] = ["owner", "finance", "project_manager"];

const emptySchema: AIJSONSchema = { type: "object", properties: {}, required: [], additionalProperties: false };
const idSchema = (key: string, description: string): AIJSONSchema => ({
  type: "object",
  properties: { [key]: { type: "integer", description } },
  required: [key],
  additionalProperties: false,
});
const searchSchema: AIJSONSchema = {
  type: "object",
  properties: {
    query: { type: "string", description: "名称或编号关键词" },
    limit: { type: "integer", minimum: 1, maximum: 20, description: "最多返回数量" },
  },
  required: ["query", "limit"],
  additionalProperties: false,
};
const daysSchema: AIJSONSchema = {
  type: "object",
  properties: { days: { type: "integer", enum: [7, 30], description: "预测天数" } },
  required: ["days"],
  additionalProperties: false,
};

function define(name: string, description: string, parameters: AIJSONSchema, roles: SessionUser["role"][], execute: RegisteredAITool["execute"]): RegisteredAITool {
  return { definition: { name, description, parameters }, roles, execute };
}

function integerArg(args: Record<string, unknown>, key: string, pageContext: AIPageContext) {
  const value = Number(args[key] ?? pageContext[key as keyof AIPageContext]);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`缺少有效的 ${key}`);
  return value;
}

function limitArg(args: Record<string, unknown>) {
  return Math.max(1, Math.min(20, Number(args.limit) || 10));
}

function ensureCompany(scope: number | null, companyId: unknown) {
  if (scope !== null && Number(companyId) !== scope) throw new Error("FORBIDDEN");
}

async function authorizedProject(projectId: number, context: AIToolContext) {
  const detail = await getProjectDetail(projectId, context.user);
  if (!detail) throw new Error("项目不存在或无权查看");
  ensureCompany(context.companyScope, detail.project.companyId);
  return detail;
}

function moneyEvidence(label: string, cents: unknown, href?: string) {
  const value = Number(cents ?? 0) / 100;
  return { label, value: `¥${value.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, href };
}

async function dashboardResult(context: AIToolContext): Promise<AIToolResult> {
  const dashboard = await getDashboardData(context.user, context.companyScope);
  const analytics = await getDashboardAnalytics(context.user, context.companyScope, dashboard.summary.balance);
  const firstGap = analytics.cashflow.find((point) => point.balanceCents < 0) ?? null;
  const cashflowHorizon = [7, 15, 30].map((day) => ({ day, ...(analytics.cashflow[Math.min(day, analytics.cashflow.length) - 1] ?? {}) }));
  const summary = {
    ...(dashboard.summary.balanceAccessible ? { balance: dashboard.summary.balance } : { balanceAccessible: false }),
    ...(dashboard.summary.receivableAccessible ? { receivable30: dashboard.summary.receivable30, overdueReceivables: dashboard.summary.overdueReceivables } : { receivableAccessible: false }),
    ...(dashboard.summary.payableAccessible ? { payable30: dashboard.summary.payable30, missingInvoice: dashboard.summary.missingInvoice } : { payableAccessible: false }),
    ...(dashboard.summary.purchaseRequestAccessible ? { pendingPurchases: dashboard.summary.pendingPurchases, pendingPurchaseCents: dashboard.summary.pendingPurchaseCents } : { purchaseRequestAccessible: false }),
    ...(dashboard.summary.paymentApprovalAccessible ? { pendingPayments: dashboard.summary.pendingPayments, pendingPaymentCents: dashboard.summary.pendingPaymentCents } : { paymentApprovalAccessible: false }),
    activeProjects: dashboard.summary.activeProjects,
  };
  const evidence = [
    ...(dashboard.summary.balanceAccessible ? [moneyEvidence("当前资金余额", dashboard.summary.balance, "/finance-workspace")] : []),
    ...(dashboard.summary.receivableAccessible ? [moneyEvidence("30 天应收", dashboard.summary.receivable30, "/receivables")] : []),
    ...(dashboard.summary.payableAccessible ? [moneyEvidence("30 天应付", dashboard.summary.payable30, "/payables")] : []),
    ...(dashboard.summary.purchaseRequestAccessible ? [moneyEvidence(`待审批采购（${dashboard.summary.pendingPurchases} 笔）`, dashboard.summary.pendingPurchaseCents, "/purchase-requests")] : []),
    ...(dashboard.summary.paymentApprovalAccessible ? [moneyEvidence(`待审批付款（${dashboard.summary.pendingPayments} 笔）`, dashboard.summary.pendingPaymentCents, "/payment-requests")] : []),
    { label: "活跃项目", value: `${dashboard.summary.activeProjects} 个`, href: "/projects" },
  ];
  return {
    summary: "经营驾驶舱、未来 30 天现金流和项目健康数据",
    data: { summary, balances: dashboard.balances, overBudget: dashboard.overBudget, recentPendingSamples: dashboard.pending, cashflowHorizon, firstGap, projectHealth: analytics.projectHealth },
    evidence,
  };
}

async function projectSummary(args: Record<string, unknown>, context: AIToolContext): Promise<AIToolResult> {
  const id = integerArg(args, "projectId", context.pageContext);
  const detail = await authorizedProject(id, context);
  const visible = projectAIDTO(detail, context.user.role);
  return {
    summary: `项目 ${detail.project.name} 的授权范围摘要`,
    data: visible,
    evidence: [
      { label: "项目", value: `${detail.project.code} · ${detail.project.name}`, href: `/projects/${id}` },
      moneyEvidence("当前预算", detail.project.budgetCents, `/projects/${id}?tab=budgets`),
      moneyEvidence("已下单", detail.metrics.orderedCents, `/projects/${id}?tab=procurement`),
    ],
  };
}

async function projectAnalyticsResult(kind: "cash" | "cost" | "pipeline", args: Record<string, unknown>, context: AIToolContext): Promise<AIToolResult> {
  const id = integerArg(args, "projectId", context.pageContext);
  const detail = await authorizedProject(id, context);
  const analytics = await getProjectAnalytics(id);
  const data = kind === "cash" ? analytics.cashCurve : kind === "cost" ? analytics.costCategories : analytics.pipeline;
  return {
    summary: `${detail.project.name} 的${kind === "cash" ? "收付款曲线" : kind === "cost" ? "成本分类" : "采购管线"}`,
    data,
    evidence: [{ label: "项目", value: detail.project.name, href: `/projects/${id}` }],
  };
}

async function supplierResult(kind: "profile" | "invoice" | "purchases", args: Record<string, unknown>, context: AIToolContext): Promise<AIToolResult> {
  const id = integerArg(args, "supplierId", context.pageContext);
  const profile = await getSupplierProfile(id, context.user);
  if (!profile) throw new Error("供应商不存在或无权查看");
  ensureCompany(context.companyScope, profile.supplier.companyId);
  const name = String(profile.supplier.name);
  if (kind === "purchases") {
    const sections = await getSupplierSections(id, "orders");
    const rows = sections.flatMap((section) => section.rows).slice(0, 20).map((row) => ({ orderId: row.id, projectName: row.projectName, amountCents: row.amountCents, deliveredCents: row.deliveredCents, orderedAt: row.orderedAt, status: row.status }));
    return { summary: `${name} 的采购历史`, data: { supplierId: id, supplierName: name, rows }, evidence: [{ label: "供应商", value: name, href: `/suppliers/${id}?tab=orders` }] };
  }
  const [operations] = await sqlQuery<Record<string, unknown>>(`SELECT
    (SELECT count(*)::int FROM purchase_orders po WHERE po.supplier_id=$1 AND NOT po.is_void) AS "orderCount",
    COALESCE((SELECT round(avg(q.lead_days))::int FROM supplier_quotes q WHERE q.supplier_id=$1),0) AS "averageLeadDays",
    CASE WHEN (SELECT count(*) FROM purchase_orders po WHERE po.supplier_id=$1 AND NOT po.is_void)=0 THEN 0 ELSE round(
      (SELECT count(*) FROM purchase_returns r JOIN purchase_orders rpo ON rpo.id=r.purchase_order_id WHERE rpo.supplier_id=$1 AND NOT r.is_void)*100.0/
      (SELECT count(*) FROM purchase_orders po WHERE po.supplier_id=$1 AND NOT po.is_void),2)::float8 END AS "returnRate"`, [id]);
  const profileDTO = supplierAIDTO(profile, operations ?? {});
  const data = kind === "invoice" ? { supplierId: id, supplierName: name, missingInvoiceCents: profileDTO.missingInvoiceCents, payableCents: profileDTO.payableCents } : profileDTO;
  return {
    summary: kind === "invoice" ? `${name} 的发票覆盖与欠票缺口` : `${name} 的供应商档案`,
    data,
    evidence: [
      { label: "供应商", value: name, href: `/suppliers/${id}` },
      moneyEvidence("欠票缺口", profile.metrics.missingInvoiceCents, `/suppliers/${id}?tab=invoices`),
    ],
  };
}

async function customerResult(kind: "profile" | "receivables", args: Record<string, unknown>, context: AIToolContext): Promise<AIToolResult> {
  const id = integerArg(args, "customerId", context.pageContext);
  const profile = await getCustomerProfile(id, context.user);
  if (!profile) throw new Error("客户不存在或无权查看");
  ensureCompany(context.companyScope, profile.customer.companyId);
  const name = String(profile.customer.name);
  const data = kind === "receivables"
    ? { ...customerAIDTO(profile), rows: (await getCustomerSections(id, "receivables")).flatMap((section) => section.rows).slice(0, 20).map((row) => ({ receivableId: row.id, projectName: row.projectName, nodeName: row.nodeName, amountCents: row.amountCents, receivedCents: row.receivedCents, dueDate: row.dueDate, status: row.status })) }
    : customerAIDTO(profile);
  return {
    summary: `${name} 的${kind === "receivables" ? "应收计划" : "客户档案"}`,
    data,
    evidence: [
      { label: "客户", value: name, href: `/customers/${id}` },
      moneyEvidence("逾期应收", profile.metrics.overdueCents, `/customers/${id}?tab=receivables`),
    ],
  };
}

async function purchaseRequestResult(kind: "detail" | "risks", args: Record<string, unknown>, context: AIToolContext): Promise<AIToolResult> {
  const id = integerArg(args, "purchaseRequestId", context.pageContext);
  const detail = await getPurchaseApprovalDetail(id, context.user);
  ensureCompany(context.companyScope, detail.header.companyId);
  const dto = purchaseRequestAIDTO(detail);
  const risks = dto.items.filter((item) => Number(item.overBudgetCents) > 0).map((item) => ({ skuCode: item.skuCode, skuName: item.skuName, overBudgetCents: item.overBudgetCents, overBudgetPercent: item.overBudgetPercent }));
  return {
    summary: `采购申请 ${String(detail.header.number)} 的${kind === "risks" ? "风险核查" : "单据明细"}`,
    data: kind === "risks" ? { header: dto.header, overBudgetItems: risks, quoteCount: dto.quotes.length, approvals: dto.approvals } : dto,
    evidence: [{ label: "采购申请", value: String(detail.header.number), href: `/purchase-requests?open=${id}` }, moneyEvidence("申请金额", detail.header.amountCents)],
  };
}

async function paymentRequestResult(kind: "detail" | "risks", args: Record<string, unknown>, context: AIToolContext): Promise<AIToolResult> {
  const id = integerArg(args, "paymentRequestId", context.pageContext);
  const detail = await getPaymentApprovalDetail(id, context.user);
  ensureCompany(context.companyScope, detail.header.companyId);
  const header = detail.header;
  const dto = paymentRequestAIDTO(detail);
  const balance = dto.header.accountBalance;
  const risks = {
    insufficientBalance: balance.accessible ? Number(balance.balanceAfterCents) < 0 : null,
    missingInvoice: Number(header.missingInvoiceCents) > 0,
    overpay: Number(header.remainingAfterCents) < 0,
    requestAmountCents: header.requestAmountCents,
    accountBalance: balance,
    missingInvoiceCents: header.missingInvoiceCents,
    remainingAfterCents: header.remainingAfterCents,
    invoiceStatus: header.invoiceStatus,
  };
  return {
    summary: `付款申请 ${String(header.number)} 的${kind === "risks" ? "只读风险核查" : "单据明细"}`,
    data: kind === "risks" ? { header: dto.header, risks, approvals: dto.approvals } : dto,
    evidence: [
      { label: "付款申请", value: String(header.number), href: `/payment-requests?open=${id}` },
      moneyEvidence("申请金额", header.requestAmountCents),
      ...(balance.accessible ? [moneyEvidence("付款后余额", balance.balanceAfterCents)] : []),
    ],
  };
}

async function scheduledAmounts(kind: "receivable" | "payable", args: Record<string, unknown>, context: AIToolContext): Promise<AIToolResult> {
  const days = Number(args.days) === 7 ? 7 : 30;
  const alias = kind === "receivable" ? "rp" : "y";
  const scope = analyticsScope(context.user, context.companyScope, alias, `${alias}.project_id`);
  const rangeParameter = `$${scope.params.length + 1}`;
  const commonCondition = `${scope.clause} AND NOT ${alias}.is_void AND ${alias}.${kind === "receivable" ? "received_cents<rp.amount_cents" : "paid_cents<y.amount_cents"} AND ${alias}.due_date<=current_date+(${rangeParameter}||' day')::interval`;
  const queryParams = [...scope.params, days];
  const rows = kind === "receivable"
    ? await sqlQuery<Record<string, unknown>>(`SELECT rp.id,p.name AS "projectName",cu.name AS "customerName",rp.node_name AS "nodeName",rp.due_date::text AS "dueDate",(rp.amount_cents-rp.received_cents)::float8 AS "amountCents" FROM receivable_plans rp JOIN projects p ON p.id=rp.project_id JOIN customers cu ON cu.id=p.customer_id WHERE ${commonCondition} AND NOT rp.is_warranty ORDER BY rp.due_date LIMIT 30`, queryParams)
    : await sqlQuery<Record<string, unknown>>(`SELECT y.id,p.name AS "projectName",s.name AS "supplierName",y.number,y.due_date::text AS "dueDate",(y.amount_cents-y.paid_cents)::float8 AS "amountCents",y.invoice_status AS "invoiceStatus" FROM payables y JOIN projects p ON p.id=y.project_id JOIN suppliers s ON s.id=y.supplier_id WHERE ${commonCondition} ORDER BY y.due_date LIMIT 30`, queryParams);
  const aggregateCondition = kind === "receivable" ? `${commonCondition} AND NOT rp.is_warranty` : commonCondition;
  const [aggregate] = await sqlQuery<{ totalCents: number; rowCount: number; missingInvoiceTotalCents?: number; missingInvoiceCount?: number }>(
    kind === "receivable"
      ? `SELECT COALESCE(sum(rp.amount_cents-rp.received_cents),0)::float8 AS "totalCents",count(*)::int AS "rowCount" FROM receivable_plans rp WHERE ${aggregateCondition}`
      : `SELECT COALESCE(sum(y.amount_cents-y.paid_cents),0)::float8 AS "totalCents",count(*)::int AS "rowCount",COALESCE(sum(y.amount_cents-y.paid_cents) FILTER (WHERE y.invoice_status='欠票'),0)::float8 AS "missingInvoiceTotalCents",count(*) FILTER (WHERE y.invoice_status='欠票')::int AS "missingInvoiceCount" FROM payables y WHERE ${aggregateCondition}`,
    queryParams,
  );
  const invoiceStatusTotals = kind === "payable"
    ? await sqlQuery<{ invoiceStatus: string; rowCount: number; totalCents: number }>(`SELECT y.invoice_status AS "invoiceStatus",count(*)::int AS "rowCount",COALESCE(sum(y.amount_cents-y.paid_cents),0)::float8 AS "totalCents" FROM payables y WHERE ${aggregateCondition} GROUP BY y.invoice_status ORDER BY "totalCents" DESC`, queryParams)
    : [];
  const largestMissingInvoiceRows = kind === "payable"
    ? await sqlQuery<Record<string, unknown>>(`SELECT y.id,p.name AS "projectName",s.name AS "supplierName",y.number,y.due_date::text AS "dueDate",(y.amount_cents-y.paid_cents)::float8 AS "amountCents",y.invoice_status AS "invoiceStatus" FROM payables y JOIN projects p ON p.id=y.project_id JOIN suppliers s ON s.id=y.supplier_id WHERE ${aggregateCondition} AND y.invoice_status='欠票' ORDER BY "amountCents" DESC,y.due_date LIMIT 3`, queryParams)
    : [];
  const largestMissingInvoiceTotalCents = largestMissingInvoiceRows.reduce((sum, row) => sum + Number(row.amountCents), 0);
  const total = Number(aggregate?.totalCents ?? 0);
  const data = {
    days,
    totalCents: total,
    rowCount: Number(aggregate?.rowCount ?? 0),
    returnedRowCount: rows.length,
    rows,
    ...(kind === "payable" ? {
      invoiceStatusTotals,
      missingInvoiceCount: Number(aggregate?.missingInvoiceCount ?? 0),
      missingInvoiceTotalCents: Number(aggregate?.missingInvoiceTotalCents ?? 0),
      largestMissingInvoiceRows,
      largestMissingInvoiceTotalCents,
    } : {}),
  };
  const evidence = [moneyEvidence(`${days} 天${kind === "receivable" ? "应收" : "应付"}`, total, kind === "receivable" ? "/receivables" : "/payables")];
  if (kind === "payable") {
    evidence.push(moneyEvidence(`其中欠票（${data.missingInvoiceCount} 笔）`, data.missingInvoiceTotalCents, "/payables"));
    evidence.push(moneyEvidence("最大三笔欠票合计", largestMissingInvoiceTotalCents, "/payables"));
    for (const row of largestMissingInvoiceRows) {
      evidence.push(moneyEvidence(`欠票 ${String(row.number)} · ${String(row.supplierName)}`, row.amountCents, "/payables"));
    }
  }
  return { summary: `${days} 天内${kind === "receivable" ? "应收" : "应付"}的精确汇总及最多 30 条明细`, data, evidence };
}

async function overdueReceivables(args: Record<string, unknown>, context: AIToolContext): Promise<AIToolResult> {
  const scope = analyticsScope(context.user, context.companyScope, "rp", "rp.project_id");
  const rows = await sqlQuery<Record<string, unknown>>(`SELECT rp.id,p.id AS "projectId",p.name AS "projectName",cu.name AS "customerName",rp.node_name AS "nodeName",rp.due_date::text AS "dueDate",(current_date-rp.due_date::date)::int AS "overdueDays",(rp.amount_cents-rp.received_cents)::float8 AS "amountCents" FROM receivable_plans rp JOIN projects p ON p.id=rp.project_id JOIN customers cu ON cu.id=p.customer_id WHERE ${scope.clause} AND NOT rp.is_void AND NOT rp.is_warranty AND rp.received_cents<rp.amount_cents AND rp.due_date<current_date ORDER BY "amountCents" DESC LIMIT $${scope.params.length + 1}`, [...scope.params, limitArg(args)]);
  const total = rows.reduce((sum, row) => sum + Number(row.amountCents), 0);
  return { summary: "逾期客户应收清单", data: { totalCents: total, rows }, evidence: [moneyEvidence("逾期应收", total, "/receivables")] };
}

async function companyBalances(context: AIToolContext): Promise<AIToolResult> {
  const params: unknown[] = [];
  const clause = context.companyScope === null ? "TRUE" : (params.push(context.companyScope), `a.company_id=$${params.length}`);
  const rows = await sqlQuery<Record<string, unknown>>(`SELECT a.id,c.name AS "companyName",a.name,a.type,a.bank,a.last_four AS "lastFour",a.balance_cents::float8 AS "balanceCents",a.status FROM company_accounts a JOIN companies c ON c.id=a.company_id WHERE ${clause} AND a.status='active' ORDER BY c.id,a.id`, params);
  const total = rows.reduce((sum, row) => sum + Number(row.balanceCents), 0);
  return { summary: "授权公司账户余额", data: { totalCents: total, rows }, evidence: [moneyEvidence("账户余额合计", total, "/accounts")] };
}

async function searchEntities(entity: "project" | "supplier" | "customer", args: Record<string, unknown>, context: AIToolContext): Promise<AIToolResult> {
  const query = String(args.query ?? "").trim().slice(0, 80);
  if (!query) throw new Error("请输入查询关键词");
  const limit = limitArg(args);
  const params: unknown[] = [`%${query}%`];
  let statement = "";
  if (entity === "project") {
    const scope = analyticsScope(context.user, context.companyScope, "p", "p.id");
    const shifted = scope.clause.replace(/\$(\d+)/g, (_, value: string) => `$${Number(value) + 1}`);
    statement = `SELECT p.id,p.code,p.name,p.status,c.name AS "companyName" FROM projects p JOIN companies c ON c.id=p.company_id WHERE (p.name ILIKE $1 OR p.code ILIKE $1) AND ${shifted} ORDER BY p.updated_at DESC LIMIT $${scope.params.length + 2}`;
    params.push(...scope.params, limit);
  } else if (entity === "supplier") {
    if (context.companyScope !== null) params.push(context.companyScope);
    if (context.user.role === "project_manager") params.push(context.user.id);
    const scope = [context.companyScope !== null ? `s.company_id=$2` : "TRUE", context.user.role === "project_manager" ? `EXISTS (SELECT 1 FROM projects p JOIN project_members pm ON pm.project_id=p.id WHERE pm.user_id=$${params.length} AND (EXISTS (SELECT 1 FROM purchase_orders po WHERE po.project_id=p.id AND po.supplier_id=s.id) OR EXISTS (SELECT 1 FROM skus k WHERE k.project_id=p.id AND k.supplier_id=s.id)))` : "TRUE"].join(" AND ");
    params.push(limit);
    statement = `SELECT s.id,s.code,s.name,s.category,s.status FROM suppliers s WHERE (s.name ILIKE $1 OR s.code ILIKE $1) AND ${scope} ORDER BY s.updated_at DESC LIMIT $${params.length}`;
  } else {
    if (context.companyScope !== null) params.push(context.companyScope);
    const scope = context.companyScope !== null ? "cu.company_id=$2" : "TRUE";
    params.push(limit);
    statement = `SELECT cu.id,cu.code,cu.name,cu.type,cu.status FROM customers cu WHERE (cu.name ILIKE $1 OR cu.code ILIKE $1) AND ${scope} ORDER BY cu.updated_at DESC LIMIT $${params.length}`;
  }
  const rows = await sqlQuery<Record<string, unknown>>(statement, params);
  const path = entity === "project" ? "projects" : entity === "supplier" ? "suppliers" : "customers";
  return { summary: `找到 ${rows.length} 个匹配的${entity === "project" ? "项目" : entity === "supplier" ? "供应商" : "客户"}`, data: rows, evidence: rows.slice(0, 5).map((row) => ({ label: entity === "project" ? "项目" : entity === "supplier" ? "供应商" : "客户", value: String(row.name), href: `/${path}/${row.id}` })) };
}

export const aiTools: RegisteredAITool[] = [
  define("get_dashboard_brief", "读取当前授权范围的经营驾驶舱、待办、现金流和项目健康数据", emptySchema, ["owner", "finance", "project_manager"], (_, context) => dashboardResult(context)),
  define("get_cashflow_forecast", "读取未来 7 或 30 天现金流预测，仅限老板和财务", daysSchema, financeRoles, async (args, context) => {
    const dashboard = await getDashboardData(context.user, context.companyScope);
    const analytics = await getFinanceAnalytics(context.user, context.companyScope, Number(dashboard.summary.balance));
    const days = Number(args.days) === 7 ? 7 : 30;
    return { summary: `未来 ${days} 天现金流预测`, data: { days, balanceToday: analytics.balanceToday, projectedBalanceCents: days === 7 ? analytics.balance7 : analytics.balance30, cashflow: analytics.cashflow.slice(0, days) }, evidence: [moneyEvidence("当前余额", analytics.balanceToday, "/finance-workspace"), moneyEvidence(`${days} 天预计余额`, days === 7 ? analytics.balance7 : analytics.balance30, "/finance-workspace")] };
  }),
  define("get_company_balances", "读取授权公司账户余额", emptySchema, financeRoles, (_, context) => companyBalances(context)),
  define("get_overdue_receivables", "读取逾期客户应收，按金额排序", { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 20 } }, required: ["limit"], additionalProperties: false }, projectFinanceRoles, overdueReceivables),
  define("get_upcoming_receivables", "读取未来 7 或 30 天及已逾期的未收应收", daysSchema, projectFinanceRoles, (args, context) => scheduledAmounts("receivable", args, context)),
  define("get_upcoming_payables", "读取未来 7 或 30 天及已逾期的未付应付", daysSchema, ["owner", "finance", "procurement", "project_manager"], (args, context) => scheduledAmounts("payable", args, context)),
  define("get_project_summary", "读取一个已授权项目的基本信息、核心指标和风险", idSchema("projectId", "项目 ID；使用页面上下文中的 projectId"), allRoles, projectSummary),
  define("get_project_health", "计算项目健康分、风险原因和关键经营指标", idSchema("projectId", "项目 ID"), projectFinanceRoles, async (args, context) => {
    const id = integerArg(args, "projectId", context.pageContext); const detail = await authorizedProject(id, context);
    const visible = projectAIDTO(detail, context.user.role);
    const health = calculateProjectHealth({ contractCents: detail.project.currentContractCents, budgetCents: detail.project.budgetCents, receivedCents: detail.metrics.receivedCents, orderedCents: detail.metrics.orderedCents, payableCents: detail.metrics.payableCents, paidCents: detail.metrics.paidCents, purchaseInvoicedCents: detail.metrics.purchaseInvoicedCents, overdueReceivableCents: detail.metrics.overdueReceivableCents });
    return { summary: `${detail.project.name} 项目健康评估`, data: { health, risks: visible.risks, metrics: visible.metrics }, evidence: [{ label: "健康分", value: `${health.score} · ${health.label}`, href: `/projects/${id}` }] };
  }),
  define("get_project_cash_curve", "读取项目累计收款与付款曲线", idSchema("projectId", "项目 ID"), projectFinanceRoles, (args, context) => projectAnalyticsResult("cash", args, context)),
  define("get_project_cost_breakdown", "读取项目按品类汇总的采购成本", idSchema("projectId", "项目 ID"), allRoles, (args, context) => projectAnalyticsResult("cost", args, context)),
  define("get_project_procurement_pipeline", "读取项目 SKU 从询价到到货的采购管线", idSchema("projectId", "项目 ID"), allRoles, (args, context) => projectAnalyticsResult("pipeline", args, context)),
  define("get_project_risks", "读取项目已由系统规则识别的经营风险", idSchema("projectId", "项目 ID"), projectFinanceRoles, async (args, context) => {
    const id = integerArg(args, "projectId", context.pageContext); const detail = await authorizedProject(id, context);
    const visible = projectAIDTO(detail, context.user.role);
    return { summary: `${detail.project.name} 的项目风险`, data: { risks: visible.risks, metrics: visible.metrics }, evidence: [{ label: "风险项", value: `${visible.risks.length} 项`, href: `/projects/${id}` }] };
  }),
  define("get_supplier_profile", "读取供应商档案与合作指标", idSchema("supplierId", "供应商 ID"), ["owner", "finance", "procurement"], (args, context) => supplierResult("profile", args, context)),
  define("get_supplier_invoice_gap", "读取供应商应付、进项发票与欠票缺口", idSchema("supplierId", "供应商 ID"), ["owner", "finance", "procurement"], (args, context) => supplierResult("invoice", args, context)),
  define("get_supplier_purchase_history", "读取供应商采购订单历史", idSchema("supplierId", "供应商 ID"), ["owner", "finance", "procurement"], (args, context) => supplierResult("purchases", args, context)),
  define("get_customer_profile", "读取客户档案和合同、收款指标", idSchema("customerId", "客户 ID"), financeRoles, (args, context) => customerResult("profile", args, context)),
  define("get_customer_receivables", "读取客户应收节点和逾期状态", idSchema("customerId", "客户 ID"), financeRoles, (args, context) => customerResult("receivables", args, context)),
  define("get_purchase_request_detail", "读取采购申请、SKU、报价和审批历史", idSchema("purchaseRequestId", "采购申请 ID"), ["owner", "procurement", "project_manager", "designer"], (args, context) => purchaseRequestResult("detail", args, context)),
  define("get_purchase_request_risks", "核查采购申请中的超预算、报价和审批风险", idSchema("purchaseRequestId", "采购申请 ID"), ["owner", "procurement", "project_manager", "designer"], (args, context) => purchaseRequestResult("risks", args, context)),
  define("get_payment_request_detail", "读取付款申请、应付、账户与审批历史", idSchema("paymentRequestId", "付款申请 ID"), ["owner", "finance", "project_manager"], (args, context) => paymentRequestResult("detail", args, context)),
  define("get_payment_request_risks", "只读核查付款后的账户余额、欠票和超付风险", idSchema("paymentRequestId", "付款申请 ID"), ["owner", "finance", "project_manager"], (args, context) => paymentRequestResult("risks", args, context)),
  define("search_projects", "按名称或编码搜索当前授权范围的项目", searchSchema, allRoles, (args, context) => searchEntities("project", args, context)),
  define("search_suppliers", "按名称或编码搜索当前授权范围的供应商", searchSchema, ["owner", "finance", "procurement", "project_manager"], (args, context) => searchEntities("supplier", args, context)),
  define("search_customers", "按名称或编码搜索当前授权范围的客户", searchSchema, financeRoles, (args, context) => searchEntities("customer", args, context)),
];

export function getAIToolsForRole(role: SessionUser["role"]) {
  return aiTools.filter((tool) => tool.roles.includes(role));
}

export async function executeAITool(name: string, args: Record<string, unknown>, context: AIToolContext) {
  const tool = aiTools.find((candidate) => candidate.definition.name === name && candidate.roles.includes(context.user.role));
  if (!tool) throw new Error("工具不存在或当前角色无权调用");
  return tool.execute(args, context);
}

export function toolStatus(name: string) {
  if (name.includes("search")) return "正在定位业务对象...";
  if (name.includes("payment") || name.includes("payable")) return "正在核对付款、应付与账户...";
  if (name.includes("receivable") || name.includes("customer")) return "正在核对应收与客户回款...";
  if (name.includes("supplier") || name.includes("purchase") || name.includes("procurement")) return "正在核对采购、供应商与发票...";
  if (name.includes("project")) return "正在读取项目经营数据...";
  return "正在读取授权业务数据...";
}
