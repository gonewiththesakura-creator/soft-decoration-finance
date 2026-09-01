import { sqlQuery } from "@/db/client";
import type { SessionUser } from "@/lib/auth";
import type { ColumnDef } from "./resources";

export const projectTabs = [
  ["overview", "概览"], ["contracts", "合同"], ["receivables", "应收 / 收款"], ["procurement", "SKU / 采购"], ["payments", "应付 / 付款"],
  ["invoices", "发票"], ["budgets", "预算 / 变更"], ["returns", "退换货"], ["attachments", "附件"], ["logs", "操作日志"],
] as const;
export type ProjectTab = typeof projectTabs[number][0];
export type ProjectSection = { title: string; subtitle?: string; columns: ColumnDef[]; rows: Record<string, unknown>[] };

export async function getProjectDetail(id: number, user: SessionUser) {
  const params: unknown[] = [id]; const checks: string[] = ["p.id=$1"];
  if (user.companyId !== null) { params.push(user.companyId); checks.push(`p.company_id=$${params.length}`); }
  if (["project_manager", "designer"].includes(user.role)) { params.push(user.id); checks.push(`EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id=p.id AND pm.user_id=$${params.length})`); }
  const [project] = await sqlQuery<{
    id: number; companyId: number; customerId: number; code: string; name: string; companyName: string; customerName: string; managerName: string; designerName: string;
    address: string; status: string; currentContractCents: number; originalContractCents: number; budgetCents: number; startDate: string; expectedEndDate: string; warrantyEndDate: string; auditStatus: string;
  }>(`SELECT p.id,p.company_id AS "companyId",p.customer_id AS "customerId",p.code,p.name,c.name AS "companyName",cu.name AS "customerName",COALESCE(pm.name,'-') AS "managerName",COALESCE(d.name,'-') AS "designerName",p.address,p.status,p.current_contract_cents AS "currentContractCents",p.original_contract_cents AS "originalContractCents",p.budget_cents AS "budgetCents",p.start_date::text AS "startDate",p.expected_end_date::text AS "expectedEndDate",p.warranty_end_date::text AS "warrantyEndDate",p.audit_status AS "auditStatus" FROM projects p JOIN companies c ON c.id=p.company_id JOIN customers cu ON cu.id=p.customer_id LEFT JOIN users pm ON pm.id=p.manager_id LEFT JOIN users d ON d.id=p.designer_id WHERE ${checks.join(" AND ")}`, params);
  if (!project) return null;
  const [metrics] = await sqlQuery<{
    receivedCents: number; receivableCents: number; overdueReceivableCents: number; futureReceivableCents: number; appliedCents: number; orderedCents: number; deliveredCents: number; payableCents: number; paidCents: number; purchaseInvoicedCents: number; salesInvoicedCents: number; futurePayableCents: number; pendingPurchases: number; pendingPayments: number; approvedPayments: number; warrantyDue: number;
  }>(`SELECT
    (SELECT COALESCE(sum(amount_cents),0)::float8 FROM receipts WHERE project_id=$1 AND NOT is_void) AS "receivedCents",
    (SELECT COALESCE(sum(amount_cents-received_cents),0)::float8 FROM receivable_plans WHERE project_id=$1 AND NOT is_void) AS "receivableCents",
    (SELECT COALESCE(sum(amount_cents-received_cents),0)::float8 FROM receivable_plans WHERE project_id=$1 AND NOT is_void AND due_date<now() AND received_cents<amount_cents) AS "overdueReceivableCents",
    (SELECT COALESCE(sum(amount_cents-received_cents),0)::float8 FROM receivable_plans WHERE project_id=$1 AND NOT is_void AND due_date BETWEEN now() AND now()+interval '30 day') AS "futureReceivableCents",
    (SELECT COALESCE(sum(amount_cents),0)::float8 FROM purchase_requests WHERE project_id=$1 AND NOT is_void AND status NOT IN ('已驳回','已作废')) AS "appliedCents",
    (SELECT COALESCE(sum(amount_cents),0)::float8 FROM purchase_orders WHERE project_id=$1 AND NOT is_void) AS "orderedCents",
    (SELECT COALESCE(sum(delivered_cents),0)::float8 FROM purchase_orders WHERE project_id=$1 AND NOT is_void) AS "deliveredCents",
    (SELECT COALESCE(sum(amount_cents),0)::float8 FROM payables WHERE project_id=$1 AND NOT is_void) AS "payableCents",
    (SELECT COALESCE(sum(amount_cents),0)::float8 FROM payments WHERE project_id=$1 AND NOT is_void) AS "paidCents",
    (SELECT COALESCE(sum(ia.amount_cents),0)::float8 FROM invoice_allocations ia JOIN invoices i ON i.id=ia.invoice_id WHERE ia.project_id=$1 AND i.direction='进项' AND NOT i.is_void) AS "purchaseInvoicedCents",
    (SELECT COALESCE(sum(ia.amount_cents),0)::float8 FROM invoice_allocations ia JOIN invoices i ON i.id=ia.invoice_id WHERE ia.project_id=$1 AND i.direction='销项' AND NOT i.is_void) AS "salesInvoicedCents",
    (SELECT COALESCE(sum(amount_cents-paid_cents),0)::float8 FROM payables WHERE project_id=$1 AND NOT is_void AND due_date BETWEEN now() AND now()+interval '30 day') AS "futurePayableCents",
    (SELECT count(*)::int FROM purchase_requests WHERE project_id=$1 AND status='待审批' AND NOT is_void) AS "pendingPurchases",
    (SELECT count(*)::int FROM payment_requests WHERE project_id=$1 AND status='待审批' AND NOT is_void) AS "pendingPayments",
    (SELECT count(*)::int FROM payment_requests WHERE project_id=$1 AND status='已通过' AND NOT is_void) AS "approvedPayments",
    (SELECT count(*)::int FROM receivable_plans WHERE project_id=$1 AND is_warranty AND NOT is_void AND due_date<=now() AND received_cents<amount_cents) AS "warrantyDue"`, [id]);
  const missingInvoiceCents = Math.max(0, metrics.payableCents - metrics.purchaseInvoicedCents);
  const remainingBudgetCents = project.budgetCents - metrics.orderedCents;
  const projectCashCents = metrics.receivedCents - metrics.paidCents;
  const currentFundingGapCents = Math.max(0, -projectCashCents);
  const risks = [
    metrics.overdueReceivableCents > 0 && { tone: "danger", label: "存在逾期应收", value: metrics.overdueReceivableCents },
    remainingBudgetCents < 0 && { tone: "danger", label: "存在超预算采购", value: -remainingBudgetCents },
    missingInvoiceCents > 0 && { tone: "warning", label: "存在供应商欠票", value: missingInvoiceCents },
    metrics.pendingPurchases > 0 && { tone: "warning", label: `${metrics.pendingPurchases} 笔采购待审批` },
    metrics.pendingPayments > 0 && { tone: "warning", label: `${metrics.pendingPayments} 笔付款待审批` },
    metrics.approvedPayments > 0 && { tone: "warning", label: `${metrics.approvedPayments} 笔已批准未付款` },
    Boolean(project.expectedEndDate && new Date(project.expectedEndDate) < new Date() && !["已完工", "质保关闭"].includes(project.status)) && { tone: "danger", label: "项目已超过预计结束日期" },
    metrics.warrantyDue > 0 && { tone: "warning", label: `${metrics.warrantyDue} 笔质保金待释放` },
  ].filter(Boolean) as { tone: string; label: string; value?: number }[];
  const receivables = await sqlQuery<{ id: number; nodeName: string; amountCents: number; receivedCents: number; dueDate: string; status: string }>(`SELECT id,node_name AS "nodeName",amount_cents AS "amountCents",received_cents AS "receivedCents",due_date::text AS "dueDate",CASE WHEN is_warranty AND due_date<=now() AND received_cents<amount_cents THEN '待释放质保金' WHEN received_cents>=amount_cents THEN '已收' WHEN due_date<now() THEN '已逾期' ELSE status END AS status FROM receivable_plans WHERE project_id=$1 AND NOT is_void ORDER BY due_date`, [id]);
  const timeline = await getProjectTimeline(id);
  return { project, metrics: { ...metrics, missingInvoiceCents, remainingBudgetCents, projectCashCents, currentFundingGapCents }, risks, receivables, timeline };
}

export async function getProjectTimeline(id: number) {
  return sqlQuery<{ id: string; label: string; actor: string; happenedAt: string; tone: string }>(`SELECT * FROM (
    SELECT 'log-'||l.id AS id,CASE l.action WHEN 'CREATE' THEN '创建' WHEN 'APPROVE' THEN '批准' WHEN 'REJECT' THEN '驳回' WHEN 'PAY' THEN '执行付款' WHEN 'UPLOAD' THEN '上传附件' WHEN 'VOID' THEN '作废 / 冲销' ELSE l.action END||' · '||l.object_type AS label,COALESCE(u.name,'系统') AS actor,l.created_at::text AS "happenedAt",CASE WHEN l.action IN ('REJECT','VOID') THEN 'danger' WHEN l.action='APPROVE' THEN 'success' ELSE 'normal' END AS tone FROM audit_logs l LEFT JOIN users u ON u.id=l.user_id WHERE l.project_id=$1
    UNION ALL SELECT 'receipt-'||r.id,'确认收款 '||r.number,COALESCE(u.name,'财务'),r.received_at::text,'success' FROM receipts r LEFT JOIN users u ON u.id=r.created_by WHERE r.project_id=$1 AND NOT r.is_void
    UNION ALL SELECT 'order-'||po.id,'生成采购单 '||po.number,COALESCE(u.name,'系统'),po.ordered_at::text,'normal' FROM purchase_orders po LEFT JOIN users u ON u.id=po.created_by WHERE po.project_id=$1 AND NOT po.is_void
    UNION ALL SELECT 'payment-'||f.id,'完成付款 '||f.number,COALESCE(u.name,'财务'),f.paid_at::text,'warning' FROM payments f LEFT JOIN users u ON u.id=f.created_by WHERE f.project_id=$1 AND NOT f.is_void
  ) events ORDER BY "happenedAt" DESC LIMIT 30`, [id]);
}

const table = (title: string, columns: ColumnDef[], query: string, subtitle?: string) => ({ title, columns, query, subtitle });
const tabQueries: Record<Exclude<ProjectTab, "overview" | "attachments">, ReturnType<typeof table>[]> = {
  contracts: [table("项目合同", [{ key: "number", label: "合同编号" }, { key: "name", label: "合同名称" }, { key: "amountCents", label: "金额", format: "money", align: "right" }, { key: "signedAt", label: "签约日期", format: "date" }, { key: "status", label: "状态", format: "status" }], `SELECT id,number,name,amount_cents AS "amountCents",signed_at::text AS "signedAt",status FROM contracts WHERE project_id=$1 AND NOT is_void ORDER BY signed_at DESC`)],
  receivables: [
    table("应收计划", [{ key: "nodeName", label: "节点" }, { key: "amountCents", label: "应收", format: "money", align: "right" }, { key: "receivedCents", label: "已收", format: "money", align: "right" }, { key: "dueDate", label: "到期日", format: "date" }, { key: "status", label: "状态", format: "status" }], `SELECT id,node_name AS "nodeName",amount_cents AS "amountCents",received_cents AS "receivedCents",due_date::text AS "dueDate",CASE WHEN due_date<now() AND received_cents<amount_cents THEN '已逾期' ELSE status END AS status FROM receivable_plans WHERE project_id=$1 AND NOT is_void ORDER BY due_date`),
    table("收款记录", [{ key: "number", label: "收款编号" }, { key: "nodeName", label: "应收节点" }, { key: "amountCents", label: "金额", format: "money", align: "right" }, { key: "accountName", label: "账户" }, { key: "receivedAt", label: "到账日期", format: "date" }], `SELECT r.id,r.number,rp.node_name AS "nodeName",r.amount_cents AS "amountCents",a.name AS "accountName",r.received_at::text AS "receivedAt" FROM receipts r JOIN receivable_plans rp ON rp.id=r.receivable_plan_id LEFT JOIN company_accounts a ON a.id=r.account_id WHERE r.project_id=$1 AND NOT r.is_void ORDER BY r.received_at DESC`),
  ],
  procurement: [
    table("SKU 与选定报价", [{ key: "code", label: "SKU" }, { key: "room", label: "房间" }, { key: "category", label: "品类" }, { key: "name", label: "产品" }, { key: "quantity", label: "数量", format: "number" }, { key: "supplierName", label: "供应商" }, { key: "finalCents", label: "最终采购", format: "money", align: "right" }, { key: "status", label: "状态", format: "status" }], `SELECT s.id,s.code,s.room,s.category,s.name,s.quantity,COALESCE(sup.name,'-') AS "supplierName",(s.quantity*COALESCE(s.final_unit_cents,s.budget_unit_cents)+s.freight_cents+s.install_cents)::float8 AS "finalCents",s.status FROM skus s LEFT JOIN suppliers sup ON sup.id=s.supplier_id WHERE s.project_id=$1 ORDER BY s.id`),
    table("采购申请 / 订单", [{ key: "requestNumber", label: "申请单" }, { key: "orderNumber", label: "采购单" }, { key: "supplierName", label: "供应商" }, { key: "amountCents", label: "金额", format: "money", align: "right" }, { key: "deliveredCents", label: "到货", format: "money", align: "right" }, { key: "status", label: "状态", format: "status" }], `SELECT r.id,r.number AS "requestNumber",COALESCE(po.number,'-') AS "orderNumber",s.name AS "supplierName",r.amount_cents AS "amountCents",COALESCE(po.delivered_cents,0) AS "deliveredCents",COALESCE(po.status,r.status) AS status FROM purchase_requests r JOIN suppliers s ON s.id=r.supplier_id LEFT JOIN purchase_orders po ON po.request_id=r.id AND NOT po.is_void WHERE r.project_id=$1 AND NOT r.is_void ORDER BY r.created_at DESC`),
  ],
  payments: [
    table("应付与付款申请", [{ key: "number", label: "应付编号" }, { key: "supplierName", label: "供应商" }, { key: "amountCents", label: "应付", format: "money", align: "right" }, { key: "paidCents", label: "已付", format: "money", align: "right" }, { key: "requestStatus", label: "付款申请", format: "status" }, { key: "dueDate", label: "到期日", format: "date" }, { key: "status", label: "状态", format: "status" }], `SELECT y.id,y.number,s.name AS "supplierName",y.amount_cents AS "amountCents",y.paid_cents AS "paidCents",COALESCE((SELECT status FROM payment_requests WHERE payable_id=y.id AND NOT is_void ORDER BY created_at DESC LIMIT 1),'未申请') AS "requestStatus",y.due_date::text AS "dueDate",y.status FROM payables y JOIN suppliers s ON s.id=y.supplier_id WHERE y.project_id=$1 AND NOT y.is_void ORDER BY y.due_date`),
    table("付款记录", [{ key: "number", label: "付款编号" }, { key: "supplierName", label: "供应商" }, { key: "amountCents", label: "金额", format: "money", align: "right" }, { key: "accountName", label: "账户" }, { key: "paidAt", label: "付款日期", format: "date" }], `SELECT f.id,f.number,s.name AS "supplierName",f.amount_cents AS "amountCents",a.name AS "accountName",f.paid_at::text AS "paidAt" FROM payments f JOIN payables y ON y.id=f.payable_id JOIN suppliers s ON s.id=y.supplier_id LEFT JOIN company_accounts a ON a.id=f.account_id WHERE f.project_id=$1 AND NOT f.is_void ORDER BY f.paid_at DESC`),
  ],
  invoices: [table("发票与核销", [{ key: "number", label: "发票号码" }, { key: "direction", label: "方向", format: "status" }, { key: "type", label: "票种" }, { key: "counterparty", label: "往来单位" }, { key: "amountCents", label: "金额", format: "money", align: "right" }, { key: "allocatedCents", label: "已核销", format: "money", align: "right" }, { key: "issuedAt", label: "日期", format: "date" }], `SELECT i.id,i.number,i.direction,i.type,COALESCE(cu.name,s.name) AS counterparty,i.amount_cents AS "amountCents",COALESCE((SELECT sum(amount_cents) FROM invoice_allocations WHERE invoice_id=i.id),0)::float8 AS "allocatedCents",i.issued_at::text AS "issuedAt" FROM invoices i LEFT JOIN customers cu ON cu.id=i.customer_id LEFT JOIN suppliers s ON s.id=i.supplier_id WHERE i.project_id=$1 AND NOT i.is_void ORDER BY i.issued_at DESC`)],
  budgets: [
    table("预算版本", [{ key: "version", label: "版本", format: "number" }, { key: "type", label: "类型", format: "status" }, { key: "amountCents", label: "预算金额", format: "money", align: "right" }, { key: "status", label: "状态", format: "status" }, { key: "createdAt", label: "生效日期", format: "date" }], `SELECT id,version,type,amount_cents AS "amountCents",status,created_at::text AS "createdAt" FROM project_budget_versions WHERE project_id=$1 ORDER BY version DESC`),
    table("项目变更", [{ key: "number", label: "变更编号" }, { key: "type", label: "类型", format: "status" }, { key: "adjustmentCents", label: "调整金额", format: "money", align: "right" }, { key: "newCents", label: "调整后", format: "money", align: "right" }, { key: "reason", label: "原因" }, { key: "status", label: "状态", format: "status" }], `SELECT id,number,type,adjustment_cents AS "adjustmentCents",new_cents AS "newCents",reason,status FROM project_changes WHERE project_id=$1 ORDER BY created_at DESC`),
  ],
  returns: [table("采购取消 / 退换货 / 退款", [{ key: "number", label: "业务编号" }, { key: "orderNumber", label: "采购单" }, { key: "type", label: "类型", format: "status" }, { key: "quantity", label: "数量", format: "number" }, { key: "amountCents", label: "金额", format: "money", align: "right" }, { key: "reason", label: "原因" }, { key: "status", label: "状态", format: "status" }], `SELECT r.id,r.number,po.number AS "orderNumber",r.type,r.quantity,r.amount_cents AS "amountCents",r.reason,r.status FROM purchase_returns r JOIN purchase_orders po ON po.id=r.purchase_order_id WHERE r.project_id=$1 AND NOT r.is_void ORDER BY r.created_at DESC`)],
  logs: [table("操作日志", [{ key: "createdAt", label: "时间", format: "date" }, { key: "userName", label: "操作人" }, { key: "objectType", label: "对象" }, { key: "action", label: "操作", format: "status" }, { key: "ip", label: "IP" }], `SELECT l.id,l.created_at::text AS "createdAt",COALESCE(u.name,'系统') AS "userName",l.object_type AS "objectType",l.action,l.ip FROM audit_logs l LEFT JOIN users u ON u.id=l.user_id WHERE l.project_id=$1 ORDER BY l.created_at DESC`)],
};

export async function getProjectSections(id: number, tab: Exclude<ProjectTab, "overview" | "attachments">) {
  return Promise.all(tabQueries[tab].map(async (definition) => ({ title: definition.title, subtitle: definition.subtitle, columns: definition.columns, rows: await sqlQuery(definition.query, [id]) })));
}
