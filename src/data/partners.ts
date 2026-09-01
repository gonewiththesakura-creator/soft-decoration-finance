import { sqlQuery } from "@/db/client";
import type { SessionUser } from "@/lib/auth";
import type { ColumnDef } from "./resources";

export const customerTabs = [["projects", "项目"], ["contracts", "合同"], ["receivables", "应收"], ["receipts", "收款"], ["invoices", "发票"], ["attachments", "附件"]] as const;
export const supplierTabs = [["overview", "概览"], ["quotes", "报价历史"], ["orders", "采购记录"], ["finance", "应付 / 付款"], ["invoices", "发票"], ["returns", "退换货"], ["attachments", "附件"]] as const;
export type CustomerTab = typeof customerTabs[number][0];
export type SupplierTab = typeof supplierTabs[number][0];
export type PartnerSection = { title: string; columns: ColumnDef[]; rows: Record<string, unknown>[] };

function access(user: SessionUser, tableAlias: string, projectPredicate: string) {
  const params: unknown[] = [];
  const conditions: string[] = [];
  if (user.companyId !== null) { params.push(user.companyId); conditions.push(`${tableAlias}.company_id=$${params.length}`); }
  if (["project_manager", "designer"].includes(user.role)) { params.push(user.id); conditions.push(`EXISTS (SELECT 1 FROM project_members pm_partner WHERE pm_partner.user_id=$${params.length} AND ${projectPredicate})`); }
  return { clause: conditions.length ? conditions.join(" AND ") : "TRUE", params };
}

export async function getCustomerProfile(id: number, user: SessionUser) {
  const scoped = access(user, "cu", "pm_partner.project_id IN (SELECT id FROM projects WHERE customer_id=cu.id)");
  const [customer] = await sqlQuery<Record<string, unknown>>(`SELECT cu.id,cu.company_id AS "companyId",cu.code,cu.name,cu.type,cu.contact,cu.phone,cu.status,c.name AS "companyName" FROM customers cu JOIN companies c ON c.id=cu.company_id WHERE cu.id=$${scoped.params.length + 1} AND ${scoped.clause}`, [...scoped.params, id]);
  if (!customer) return null;
  const [metrics] = await sqlQuery<{ projectCount: number; activeProjectCount: number; contractCents: number; receivedCents: number; receivableCents: number; overdueCents: number; invoicedCents: number }>(`SELECT
    (SELECT count(*)::int FROM projects WHERE customer_id=$1) AS "projectCount",
    (SELECT count(*)::int FROM projects WHERE customer_id=$1 AND status NOT IN ('已完工','质保关闭','已取消')) AS "activeProjectCount",
    (SELECT COALESCE(sum(ct.amount_cents),0)::float8 FROM contracts ct JOIN projects p ON p.id=ct.project_id WHERE p.customer_id=$1 AND NOT ct.is_void) AS "contractCents",
    (SELECT COALESCE(sum(r.amount_cents),0)::float8 FROM receipts r JOIN projects p ON p.id=r.project_id WHERE p.customer_id=$1 AND NOT r.is_void) AS "receivedCents",
    (SELECT COALESCE(sum(rp.amount_cents-rp.received_cents),0)::float8 FROM receivable_plans rp JOIN projects p ON p.id=rp.project_id WHERE p.customer_id=$1 AND NOT rp.is_void) AS "receivableCents",
    (SELECT COALESCE(sum(rp.amount_cents-rp.received_cents),0)::float8 FROM receivable_plans rp JOIN projects p ON p.id=rp.project_id WHERE p.customer_id=$1 AND NOT rp.is_void AND rp.due_date<now() AND rp.received_cents<rp.amount_cents) AS "overdueCents",
    (SELECT COALESCE(sum(i.amount_cents),0)::float8 FROM invoices i WHERE i.customer_id=$1 AND i.direction='销项' AND NOT i.is_void) AS "invoicedCents"`, [id]);
  return { customer, metrics: { ...metrics, uninvoicedCents: Math.max(0, metrics.contractCents - metrics.invoicedCents) } };
}

export async function getCustomerSections(id: number, tab: Exclude<CustomerTab, "attachments">): Promise<PartnerSection[]> {
  const definitions: Record<Exclude<CustomerTab, "attachments">, { title: string; columns: ColumnDef[]; query: string }> = {
    projects: { title: "关联项目", columns: [{ key: "code", label: "项目编码" }, { key: "name", label: "项目名称" }, { key: "currentContractCents", label: "当前合同额", format: "money", align: "right" }, { key: "receivedCents", label: "已收款", format: "money", align: "right" }, { key: "status", label: "状态", format: "status" }], query: `SELECT p.id,p.code,p.name,p.current_contract_cents AS "currentContractCents",COALESCE((SELECT sum(amount_cents) FROM receipts WHERE project_id=p.id AND NOT is_void),0)::float8 AS "receivedCents",p.status FROM projects p WHERE p.customer_id=$1 ORDER BY p.created_at DESC` },
    contracts: { title: "合同记录", columns: [{ key: "number", label: "合同编号" }, { key: "projectName", label: "项目" }, { key: "name", label: "合同名称" }, { key: "amountCents", label: "金额", format: "money", align: "right" }, { key: "signedAt", label: "签约日期", format: "date" }, { key: "status", label: "状态", format: "status" }], query: `SELECT ct.id,ct.number,p.name AS "projectName",ct.name,ct.amount_cents AS "amountCents",ct.signed_at::text AS "signedAt",ct.status FROM contracts ct JOIN projects p ON p.id=ct.project_id WHERE p.customer_id=$1 AND NOT ct.is_void ORDER BY ct.signed_at DESC` },
    receivables: { title: "应收计划", columns: [{ key: "projectName", label: "项目" }, { key: "nodeName", label: "节点" }, { key: "amountCents", label: "应收", format: "money", align: "right" }, { key: "receivedCents", label: "已收", format: "money", align: "right" }, { key: "dueDate", label: "到期日", format: "date" }, { key: "status", label: "状态", format: "status" }], query: `SELECT rp.id,p.name AS "projectName",rp.node_name AS "nodeName",rp.amount_cents AS "amountCents",rp.received_cents AS "receivedCents",rp.due_date::text AS "dueDate",CASE WHEN rp.received_cents>=rp.amount_cents THEN '已收' WHEN rp.due_date<now() THEN '已逾期' ELSE rp.status END AS status FROM receivable_plans rp JOIN projects p ON p.id=rp.project_id WHERE p.customer_id=$1 AND NOT rp.is_void ORDER BY rp.due_date` },
    receipts: { title: "收款记录", columns: [{ key: "number", label: "收款编号" }, { key: "projectName", label: "项目" }, { key: "nodeName", label: "应收节点" }, { key: "amountCents", label: "金额", format: "money", align: "right" }, { key: "accountName", label: "账户" }, { key: "receivedAt", label: "到账日期", format: "date" }], query: `SELECT r.id,r.number,p.name AS "projectName",rp.node_name AS "nodeName",r.amount_cents AS "amountCents",a.name AS "accountName",r.received_at::text AS "receivedAt" FROM receipts r JOIN projects p ON p.id=r.project_id JOIN receivable_plans rp ON rp.id=r.receivable_plan_id LEFT JOIN company_accounts a ON a.id=r.account_id WHERE p.customer_id=$1 AND NOT r.is_void ORDER BY r.received_at DESC` },
    invoices: { title: "销项发票", columns: [{ key: "number", label: "发票号码" }, { key: "projectName", label: "项目" }, { key: "type", label: "票种" }, { key: "amountCents", label: "金额", format: "money", align: "right" }, { key: "issuedAt", label: "开票日期", format: "date" }, { key: "status", label: "状态", format: "status" }], query: `SELECT i.id,i.number,p.name AS "projectName",i.type,i.amount_cents AS "amountCents",i.issued_at::text AS "issuedAt",i.status FROM invoices i JOIN projects p ON p.id=i.project_id WHERE i.customer_id=$1 AND i.direction='销项' AND NOT i.is_void ORDER BY i.issued_at DESC` },
  };
  const definition = definitions[tab];
  return [{ title: definition.title, columns: definition.columns, rows: await sqlQuery(definition.query, [id]) }];
}

export async function getSupplierProfile(id: number, user: SessionUser) {
  const scoped = access(user, "s", "pm_partner.project_id IN (SELECT project_id FROM skus WHERE supplier_id=s.id UNION SELECT project_id FROM purchase_orders WHERE supplier_id=s.id)");
  const [supplier] = await sqlQuery<Record<string, unknown>>(`SELECT s.id,s.company_id AS "companyId",s.code,s.name,s.category,s.contact,s.phone,s.tax_number AS "taxNumber",s.status,c.name AS "companyName" FROM suppliers s JOIN companies c ON c.id=s.company_id WHERE s.id=$${scoped.params.length + 1} AND ${scoped.clause}`, [...scoped.params, id]);
  if (!supplier) return null;
  const [metrics] = await sqlQuery<{ projectCount: number; ongoingOrderCount: number; returnCount: number; orderedCents: number; payableCents: number; paidCents: number; invoicedCents: number }>(`SELECT
    (SELECT count(DISTINCT project_id)::int FROM purchase_orders WHERE supplier_id=$1 AND NOT is_void) AS "projectCount",
    (SELECT count(*)::int FROM purchase_orders WHERE supplier_id=$1 AND NOT is_void AND status NOT IN ('已到货','已完成','已取消')) AS "ongoingOrderCount",
    (SELECT count(*)::int FROM purchase_returns r JOIN purchase_orders po ON po.id=r.purchase_order_id WHERE po.supplier_id=$1 AND NOT r.is_void) AS "returnCount",
    (SELECT COALESCE(sum(amount_cents),0)::float8 FROM purchase_orders WHERE supplier_id=$1 AND NOT is_void) AS "orderedCents",
    (SELECT COALESCE(sum(amount_cents),0)::float8 FROM payables WHERE supplier_id=$1 AND NOT is_void) AS "payableCents",
    (SELECT COALESCE(sum(p.amount_cents),0)::float8 FROM payments p JOIN payables y ON y.id=p.payable_id WHERE y.supplier_id=$1 AND NOT p.is_void) AS "paidCents",
    (SELECT COALESCE(sum(amount_cents),0)::float8 FROM invoices WHERE supplier_id=$1 AND direction='进项' AND NOT is_void) AS "invoicedCents"`, [id]);
  return { supplier, metrics: { ...metrics, remainingCents: metrics.payableCents - metrics.paidCents, missingInvoiceCents: Math.max(0, metrics.payableCents - metrics.invoicedCents) } };
}

export async function getSupplierSections(id: number, tab: Exclude<SupplierTab, "attachments">): Promise<PartnerSection[]> {
  if (tab === "finance") return [
    { title: "应付记录", columns: [{ key: "number", label: "应付编号" }, { key: "projectName", label: "项目" }, { key: "paymentNode", label: "付款节点" }, { key: "amountCents", label: "应付", format: "money", align: "right" }, { key: "paidCents", label: "已付", format: "money", align: "right" }, { key: "dueDate", label: "到期日", format: "date" }, { key: "status", label: "状态", format: "status" }], rows: await sqlQuery(`SELECT y.id,y.number,p.name AS "projectName",y.payment_node AS "paymentNode",y.amount_cents AS "amountCents",y.paid_cents AS "paidCents",y.due_date::text AS "dueDate",y.status FROM payables y JOIN projects p ON p.id=y.project_id WHERE y.supplier_id=$1 AND NOT y.is_void ORDER BY y.due_date`, [id]) },
    { title: "付款记录", columns: [{ key: "number", label: "付款编号" }, { key: "projectName", label: "项目" }, { key: "amountCents", label: "金额", format: "money", align: "right" }, { key: "accountName", label: "付款账户" }, { key: "paidAt", label: "付款日期", format: "date" }, { key: "status", label: "状态", format: "status" }], rows: await sqlQuery(`SELECT f.id,f.number,p.name AS "projectName",f.amount_cents AS "amountCents",a.name AS "accountName",f.paid_at::text AS "paidAt",f.status FROM payments f JOIN payables y ON y.id=f.payable_id JOIN projects p ON p.id=f.project_id LEFT JOIN company_accounts a ON a.id=f.account_id WHERE y.supplier_id=$1 AND NOT f.is_void ORDER BY f.paid_at DESC`, [id]) },
  ];
  const definitions: Record<Exclude<SupplierTab, "attachments" | "finance">, { title: string; columns: ColumnDef[]; query: string }> = {
    overview: { title: "关联项目", columns: [{ key: "code", label: "项目编码" }, { key: "name", label: "项目" }, { key: "orderedCents", label: "下单金额", format: "money", align: "right" }, { key: "paidCents", label: "已付款", format: "money", align: "right" }, { key: "status", label: "状态", format: "status" }], query: `SELECT p.id,p.code,p.name,COALESCE(sum(po.amount_cents),0)::float8 AS "orderedCents",COALESCE((SELECT sum(f.amount_cents) FROM payments f JOIN payables y ON y.id=f.payable_id WHERE y.supplier_id=$1 AND f.project_id=p.id AND NOT f.is_void),0)::float8 AS "paidCents",p.status FROM projects p JOIN purchase_orders po ON po.project_id=p.id AND po.supplier_id=$1 AND NOT po.is_void GROUP BY p.id ORDER BY p.created_at DESC` },
    quotes: { title: "报价历史", columns: [{ key: "projectName", label: "项目" }, { key: "skuCode", label: "SKU" }, { key: "productName", label: "产品" }, { key: "unitPriceCents", label: "报价", format: "money", align: "right" }, { key: "leadDays", label: "交期（天）", format: "number" }, { key: "paymentTerms", label: "付款条件" }, { key: "status", label: "状态", format: "status" }], query: `SELECT q.id,p.name AS "projectName",s.code AS "skuCode",s.name AS "productName",q.unit_price_cents AS "unitPriceCents",q.lead_days AS "leadDays",q.payment_terms AS "paymentTerms",q.status FROM supplier_quotes q JOIN projects p ON p.id=q.project_id JOIN skus s ON s.id=q.sku_id WHERE q.supplier_id=$1 ORDER BY q.created_at DESC` },
    orders: { title: "采购订单", columns: [{ key: "number", label: "采购单" }, { key: "projectName", label: "项目" }, { key: "amountCents", label: "下单金额", format: "money", align: "right" }, { key: "deliveredCents", label: "到货金额", format: "money", align: "right" }, { key: "orderedAt", label: "下单日期", format: "date" }, { key: "status", label: "状态", format: "status" }], query: `SELECT po.id,po.number,p.name AS "projectName",po.amount_cents AS "amountCents",po.delivered_cents AS "deliveredCents",po.ordered_at::text AS "orderedAt",po.status FROM purchase_orders po JOIN projects p ON p.id=po.project_id WHERE po.supplier_id=$1 AND NOT po.is_void ORDER BY po.ordered_at DESC` },
    invoices: { title: "进项发票", columns: [{ key: "number", label: "发票号码" }, { key: "projectName", label: "项目" }, { key: "type", label: "票种" }, { key: "amountCents", label: "金额", format: "money", align: "right" }, { key: "issuedAt", label: "开票日期", format: "date" }, { key: "status", label: "状态", format: "status" }], query: `SELECT i.id,i.number,p.name AS "projectName",i.type,i.amount_cents AS "amountCents",i.issued_at::text AS "issuedAt",i.status FROM invoices i JOIN projects p ON p.id=i.project_id WHERE i.supplier_id=$1 AND i.direction='进项' AND NOT i.is_void ORDER BY i.issued_at DESC` },
    returns: { title: "退换货记录", columns: [{ key: "number", label: "业务编号" }, { key: "projectName", label: "项目" }, { key: "orderNumber", label: "采购单" }, { key: "type", label: "类型", format: "status" }, { key: "amountCents", label: "金额", format: "money", align: "right" }, { key: "reason", label: "原因" }, { key: "status", label: "状态", format: "status" }], query: `SELECT r.id,r.number,p.name AS "projectName",po.number AS "orderNumber",r.type,r.amount_cents AS "amountCents",r.reason,r.status FROM purchase_returns r JOIN purchase_orders po ON po.id=r.purchase_order_id JOIN projects p ON p.id=r.project_id WHERE po.supplier_id=$1 AND NOT r.is_void ORDER BY r.created_at DESC` },
  };
  const definition = definitions[tab];
  return [{ title: definition.title, columns: definition.columns, rows: await sqlQuery(definition.query, [id]) }];
}
