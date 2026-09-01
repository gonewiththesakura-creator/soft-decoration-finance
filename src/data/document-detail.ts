import { sqlQuery } from "@/db/client";
import type { SessionUser } from "@/lib/auth";
import { assertCan, type ResourceKey } from "@/lib/permissions";

export type DocumentKind = "purchase-request" | "purchase-order" | "payable" | "payment" | "contract";
export type DocumentFact = { label: string; value: unknown; format?: "money" | "date" | "status" };
export type DocumentRelation = { label: string; value: string; href: string };

const metadata: Record<DocumentKind, { resource: ResourceKey; objectType: string; title: string; eyebrow: string }> = {
  "purchase-request": { resource: "purchase-requests", objectType: "purchase_request", title: "采购申请", eyebrow: "采购审批单据" },
  "purchase-order": { resource: "purchase-orders", objectType: "purchase_order", title: "采购订单", eyebrow: "采购执行单据" },
  payable: { resource: "payables", objectType: "payable", title: "应付单", eyebrow: "供应商应付" },
  payment: { resource: "payments", objectType: "payment", title: "付款记录", eyebrow: "资金执行单据" },
  contract: { resource: "contracts", objectType: "contract", title: "项目合同", eyebrow: "收入合同" },
};

async function authorize(row: Record<string, unknown> | undefined, user: SessionUser) {
  if (!row) return false;
  if (user.role !== "owner" && Number(row.companyId) !== user.companyId) return false;
  if (["project_manager", "designer"].includes(user.role)) {
    const [membership] = await sqlQuery<{ id: number }>(`SELECT id FROM project_members WHERE project_id=$1 AND user_id=$2`, [Number(row.projectId), user.id]);
    if (!membership) return false;
  }
  return true;
}

function relation(label: string, value: unknown, href: string): DocumentRelation | null {
  return value ? { label, value: String(value), href } : null;
}

export async function getDocumentDetail(kind: DocumentKind, id: number, user: SessionUser) {
  const meta = metadata[kind]; assertCan(user, meta.resource);
  let row: Record<string, unknown> | undefined;
  let facts: DocumentFact[] = [];
  let relations: (DocumentRelation | null)[] = [];
  let eventQuery = "";

  if (kind === "purchase-request") {
    [row] = await sqlQuery<Record<string, unknown>>(`SELECT r.id,r.company_id AS "companyId",r.project_id AS "projectId",r.number,r.amount_cents AS "amountCents",r.payment_type AS "paymentType",r.reason,r.status,r.created_at::text AS "createdAt",p.name AS "projectName",s.id AS "supplierId",s.name AS "supplierName",u.name AS "requesterName",po.id AS "orderId",po.number AS "orderNumber" FROM purchase_requests r JOIN projects p ON p.id=r.project_id JOIN suppliers s ON s.id=r.supplier_id JOIN users u ON u.id=r.requested_by LEFT JOIN purchase_orders po ON po.request_id=r.id AND NOT po.is_void WHERE r.id=$1 AND NOT r.is_void`, [id]);
    facts = [{ label: "申请金额", value: row?.amountCents, format: "money" }, { label: "付款类型", value: row?.paymentType }, { label: "申请人", value: row?.requesterName }, { label: "申请时间", value: row?.createdAt, format: "date" }, { label: "申请原因", value: row?.reason }, { label: "当前状态", value: row?.status, format: "status" }];
    relations = [relation("项目", row?.projectName, `/projects/${row?.projectId}`), relation("供应商", row?.supplierName, `/suppliers/${row?.supplierId}`), relation("采购订单", row?.orderNumber, `/purchase-orders/${row?.orderId}`)];
    eventQuery = `SELECT 'approval-'||a.id AS id,CASE a.decision WHEN '通过' THEN '采购申请审批通过' ELSE '采购申请审批驳回' END AS label,u.name AS actor,a.decided_at::text AS "happenedAt",CASE a.decision WHEN '通过' THEN 'success' ELSE 'danger' END AS tone FROM purchase_approvals a JOIN users u ON u.id=a.approver_id WHERE a.request_id=$1 UNION ALL SELECT 'order-'||po.id,'生成采购订单 '||po.number,COALESCE(u.name,'系统'),po.ordered_at::text,'success' FROM purchase_orders po LEFT JOIN users u ON u.id=po.created_by WHERE po.request_id=$1 AND NOT po.is_void`;
  } else if (kind === "purchase-order") {
    [row] = await sqlQuery<Record<string, unknown>>(`SELECT po.id,po.company_id AS "companyId",po.project_id AS "projectId",po.request_id AS "requestId",po.number,po.amount_cents AS "amountCents",po.delivered_cents AS "deliveredCents",po.status,po.ordered_at::text AS "orderedAt",p.name AS "projectName",s.id AS "supplierId",s.name AS "supplierName",r.number AS "requestNumber" FROM purchase_orders po JOIN projects p ON p.id=po.project_id JOIN suppliers s ON s.id=po.supplier_id JOIN purchase_requests r ON r.id=po.request_id WHERE po.id=$1 AND NOT po.is_void`, [id]);
    facts = [{ label: "订单金额", value: row?.amountCents, format: "money" }, { label: "已到货金额", value: row?.deliveredCents, format: "money" }, { label: "下单时间", value: row?.orderedAt, format: "date" }, { label: "当前状态", value: row?.status, format: "status" }];
    relations = [relation("项目", row?.projectName, `/projects/${row?.projectId}`), relation("供应商", row?.supplierName, `/suppliers/${row?.supplierId}`), relation("采购申请", row?.requestNumber, `/purchase-requests/${row?.requestId}`)];
    eventQuery = `SELECT 'receipt-'||g.id AS id,'到货验收 '||g.number AS label,COALESCE(u.name,'经办人') AS actor,g.received_at::text AS "happenedAt",'success' AS tone FROM goods_receipts g LEFT JOIN users u ON u.id=g.created_by WHERE g.purchase_order_id=$1 AND NOT g.is_void UNION ALL SELECT 'payable-'||y.id,'生成应付 '||y.number,COALESCE(u.name,'系统'),y.created_at::text,'normal' FROM payables y LEFT JOIN users u ON u.id=y.created_by WHERE y.purchase_order_id=$1 AND NOT y.is_void`;
  } else if (kind === "payable") {
    [row] = await sqlQuery<Record<string, unknown>>(`SELECT y.id,y.company_id AS "companyId",y.project_id AS "projectId",y.purchase_order_id AS "orderId",y.number,y.amount_cents AS "amountCents",y.paid_cents AS "paidCents",(y.amount_cents-y.paid_cents)::float8 AS "remainingCents",y.payment_node AS "paymentNode",y.due_date::text AS "dueDate",y.invoice_status AS "invoiceStatus",y.status,y.created_at::text AS "createdAt",p.name AS "projectName",s.id AS "supplierId",s.name AS "supplierName",po.number AS "orderNumber" FROM payables y JOIN projects p ON p.id=y.project_id JOIN suppliers s ON s.id=y.supplier_id JOIN purchase_orders po ON po.id=y.purchase_order_id WHERE y.id=$1 AND NOT y.is_void`, [id]);
    facts = [{ label: "应付金额", value: row?.amountCents, format: "money" }, { label: "已付款", value: row?.paidCents, format: "money" }, { label: "未付款", value: row?.remainingCents, format: "money" }, { label: "付款节点", value: row?.paymentNode }, { label: "应付日期", value: row?.dueDate, format: "date" }, { label: "发票状态", value: row?.invoiceStatus, format: "status" }, { label: "当前状态", value: row?.status, format: "status" }];
    relations = [relation("项目", row?.projectName, `/projects/${row?.projectId}`), relation("供应商", row?.supplierName, `/suppliers/${row?.supplierId}`), relation("采购订单", row?.orderNumber, `/purchase-orders/${row?.orderId}`)];
    eventQuery = `SELECT 'request-'||r.id AS id,'提交付款申请 '||r.number AS label,COALESCE(u.name,'申请人') AS actor,r.created_at::text AS "happenedAt",CASE WHEN r.status='已驳回' THEN 'danger' ELSE 'normal' END AS tone FROM payment_requests r LEFT JOIN users u ON u.id=r.requested_by WHERE r.payable_id=$1 AND NOT r.is_void UNION ALL SELECT 'payment-'||f.id,'完成付款 '||f.number,COALESCE(u.name,'财务'),f.paid_at::text,'success' FROM payments f LEFT JOIN users u ON u.id=f.created_by WHERE f.payable_id=$1 AND NOT f.is_void`;
  } else if (kind === "payment") {
    [row] = await sqlQuery<Record<string, unknown>>(`SELECT f.id,f.company_id AS "companyId",f.project_id AS "projectId",f.payable_id AS "payableId",f.payment_request_id AS "requestId",f.number,f.amount_cents AS "amountCents",f.paid_at::text AS "paidAt",f.method,f.status,p.name AS "projectName",s.id AS "supplierId",s.name AS "supplierName",y.number AS "payableNumber",r.number AS "requestNumber",a.name AS "accountName" FROM payments f JOIN projects p ON p.id=f.project_id JOIN payables y ON y.id=f.payable_id JOIN suppliers s ON s.id=y.supplier_id LEFT JOIN payment_requests r ON r.id=f.payment_request_id LEFT JOIN company_accounts a ON a.id=f.account_id WHERE f.id=$1 AND NOT f.is_void`, [id]);
    facts = [{ label: "付款金额", value: row?.amountCents, format: "money" }, { label: "付款日期", value: row?.paidAt, format: "date" }, { label: "付款账户", value: row?.accountName }, { label: "付款方式", value: row?.method }, { label: "当前状态", value: row?.status, format: "status" }];
    relations = [relation("项目", row?.projectName, `/projects/${row?.projectId}`), relation("供应商", row?.supplierName, `/suppliers/${row?.supplierId}`), relation("应付单", row?.payableNumber, `/payables/${row?.payableId}`), relation("付款申请", row?.requestNumber, "/payment-requests")];
  } else {
    [row] = await sqlQuery<Record<string, unknown>>(`SELECT ct.id,ct.company_id AS "companyId",ct.project_id AS "projectId",ct.number,ct.name,ct.amount_cents AS "amountCents",ct.signed_at::text AS "signedAt",ct.status,ct.created_at::text AS "createdAt",p.name AS "projectName",cu.id AS "customerId",cu.name AS "customerName" FROM contracts ct JOIN projects p ON p.id=ct.project_id JOIN customers cu ON cu.id=p.customer_id WHERE ct.id=$1 AND NOT ct.is_void`, [id]);
    facts = [{ label: "合同名称", value: row?.name }, { label: "合同金额", value: row?.amountCents, format: "money" }, { label: "签约日期", value: row?.signedAt, format: "date" }, { label: "当前状态", value: row?.status, format: "status" }];
    relations = [relation("项目", row?.projectName, `/projects/${row?.projectId}`), relation("客户", row?.customerName, `/customers/${row?.customerId}`)];
    eventQuery = `SELECT 'plan-'||rp.id AS id,'生成应收节点 '||rp.node_name AS label,COALESCE(u.name,'经办人') AS actor,rp.created_at::text AS "happenedAt",'normal' AS tone FROM receivable_plans rp LEFT JOIN users u ON u.id=rp.created_by WHERE rp.contract_id=$1 AND NOT rp.is_void`;
  }
  if (!(await authorize(row, user))) return null;
  const auditTypes = [meta.objectType, meta.resource];
  const events = await sqlQuery<{ id: string; label: string; actor: string; happenedAt: string; tone: string }>(`SELECT * FROM (
    SELECT 'created' AS id,'创建${meta.title}' AS label,COALESCE(u.name,'系统') AS actor,d.created_at::text AS "happenedAt",'normal' AS tone FROM (SELECT $2::timestamptz AS created_at,$3::int AS created_by) d LEFT JOIN users u ON u.id=d.created_by
    UNION ALL SELECT 'log-'||l.id,CASE l.action WHEN 'CREATE' THEN '创建记录' WHEN 'UPDATE' THEN '更新记录' WHEN 'APPROVE' THEN '审批通过' WHEN 'REJECT' THEN '审批驳回' WHEN 'PAY' THEN '执行付款' WHEN 'VOID' THEN '作废 / 冲销' WHEN 'UPLOAD' THEN '上传附件' ELSE l.action END,COALESCE(u.name,'系统'),l.created_at::text,CASE WHEN l.action IN ('REJECT','VOID') THEN 'danger' WHEN l.action IN ('APPROVE','PAY') THEN 'success' ELSE 'normal' END FROM audit_logs l LEFT JOIN users u ON u.id=l.user_id WHERE l.object_id=$1 AND l.object_type=ANY($4::text[])
    ${eventQuery ? `UNION ALL ${eventQuery}` : ""}
  ) t ORDER BY "happenedAt" DESC`, [id, row!.createdAt ?? row!.orderedAt ?? row!.paidAt ?? row!.signedAt, row!.createdBy ?? null, auditTypes]);
  return { meta, row: row!, facts, relations: relations.filter(Boolean) as DocumentRelation[], events };
}
