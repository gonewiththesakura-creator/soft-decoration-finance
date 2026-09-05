import { runTransaction, sqlQuery, type TransactionStatement } from "@/db/client";
import type { SessionUser } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { assertCan } from "@/lib/permissions";
import { assertWorkflowAccess } from "@/lib/access";

function requiredComment(comment: string) {
  const value = comment.trim();
  if (!value) throw new Error("请填写审批意见");
  return value;
}

export async function decidePurchase(requestId: number, decision: "approve" | "reject", comment: string, user: SessionUser) {
  if (user.role !== "owner") throw new Error("仅老板可以审批采购");
  comment = requiredComment(comment);
  const [request] = await sqlQuery<{ id: number; companyId: number; projectId: number; supplierId: number; number: string; amountCents: number; status: string }>(
    `SELECT id,company_id AS "companyId",project_id AS "projectId",supplier_id AS "supplierId",number,amount_cents AS "amountCents",status FROM purchase_requests WHERE id=$1 AND NOT is_void`, [requestId],
  );
  if (!request || request.status !== "待审批") throw new Error("采购申请不在待审批状态");
  const approved = decision === "approve";
  const nextStatus = approved ? "已通过" : "已驳回";
  const statements: TransactionStatement[] = [
    { query: "UPDATE purchase_requests SET status=$1,version=version+1,updated_at=now(),updated_by=$2 WHERE id=$3", params: [nextStatus, user.id, requestId] },
    { query: "INSERT INTO purchase_approvals(company_id,project_id,request_id,approver_id,decision,comment) VALUES($1,$2,$3,$4,$5,$6)", params: [request.companyId, request.projectId, requestId, user.id, approved ? "通过" : "驳回", comment] },
  ];
  const sequence = String(Date.now()).slice(-8);
  if (approved) statements.push(
    { query: `INSERT INTO purchase_orders(company_id,project_id,request_id,supplier_id,number,amount_cents,status,created_by) VALUES($1,$2,$3,$4,$5,$6,'已下单',$7) RETURNING id`, params: [request.companyId, request.projectId, request.id, request.supplierId, `CGDD-${sequence}`, request.amountCents, user.id] },
    { query: `INSERT INTO payables(company_id,project_id,supplier_id,purchase_order_id,number,amount_cents,due_date,payment_node,status,created_by) VALUES($1,$2,$3,$4,$5,$6,now()+interval '30 day','首期款','待付',$7)`, params: [request.companyId, request.projectId, request.supplierId, { fromResult: 2, key: "id" }, `YF-${sequence}`, request.amountCents, user.id] },
    { query: "UPDATE skus SET status='已下单',updated_at=now(),updated_by=$1 WHERE id IN (SELECT sku_id FROM purchase_request_items WHERE request_id=$2)", params: [user.id, requestId] },
  );
  const results = await runTransaction<{ id: number }>(statements);
  const orderId = approved ? results[2][0].id : null;
  await writeAudit({ user, companyId: request.companyId, projectId: request.projectId, objectType: "purchase_request", objectId: requestId, action: approved ? "APPROVE" : "REJECT", before: { status: request.status }, after: { status: nextStatus, orderId, comment } });
  return { status: nextStatus, orderId };
}

export async function decidePayment(requestId: number, decision: "approve" | "reject", comment: string, user: SessionUser) {
  if (user.role !== "owner") throw new Error("仅老板可以审批付款");
  comment = requiredComment(comment);
  const [request] = await sqlQuery<{ id: number; companyId: number; projectId: number; status: string }>(`SELECT id,company_id AS "companyId",project_id AS "projectId",status FROM payment_requests WHERE id=$1 AND NOT is_void`, [requestId]);
  if (!request || request.status !== "待审批") throw new Error("付款申请不在待审批状态");
  const nextStatus = decision === "approve" ? "已通过" : "已驳回";
  await runTransaction([
    { query: "UPDATE payment_requests SET status=$1,version=version+1,updated_at=now(),updated_by=$2 WHERE id=$3", params: [nextStatus, user.id, requestId] },
    { query: "INSERT INTO payment_approvals(company_id,project_id,payment_request_id,approver_id,decision,comment) VALUES($1,$2,$3,$4,$5,$6)", params: [request.companyId, request.projectId, requestId, user.id, decision === "approve" ? "通过" : "驳回", comment] },
  ]);
  await writeAudit({ user, companyId: request.companyId, projectId: request.projectId, objectType: "payment_request", objectId: requestId, action: decision === "approve" ? "APPROVE" : "REJECT", before: { status: request.status }, after: { status: nextStatus, comment } });
  return { status: nextStatus };
}

export async function executePayment(requestId: number, user: SessionUser, bankReceiptUrl: string) {
  if (user.role !== "finance") throw new Error("仅财务可以执行付款");
  if (!bankReceiptUrl.trim()) throw new Error("执行付款前必须上传银行回单");
  const [request] = await sqlQuery<{ id: number; companyId: number; projectId: number; payableId: number; accountId: number; number: string; amountCents: number; status: string }>(
    `SELECT id,company_id AS "companyId",project_id AS "projectId",payable_id AS "payableId",account_id AS "accountId",number,amount_cents AS "amountCents",status FROM payment_requests WHERE id=$1 AND NOT is_void`, [requestId],
  );
  if (!request || request.status !== "已通过") throw new Error("付款申请尚未通过或已执行");
  if (request.companyId !== user.companyId) throw new Error("无权操作其他公司数据");
  const [account] = await sqlQuery<{ balanceCents: number }>(`SELECT balance_cents AS "balanceCents" FROM company_accounts WHERE id=$1 AND company_id=$2`, [request.accountId, request.companyId]);
  if (!account) throw new Error("付款账户不存在");
  if (Number(account.balanceCents) < Number(request.amountCents)) throw new Error("付款账户余额不足");
  const [payable] = await sqlQuery<{ amountCents: number; paidCents: number }>(`SELECT amount_cents AS "amountCents",paid_cents AS "paidCents" FROM payables WHERE id=$1 AND NOT is_void`, [request.payableId]);
  if (!payable || Number(payable.paidCents) + Number(request.amountCents) > Number(payable.amountCents)) throw new Error("付款金额超过应付余额");
  const number = `FK-${String(Date.now()).slice(-9)}`;
  const results = await runTransaction<{ id: number }>([
    { query: `INSERT INTO payments(company_id,project_id,payable_id,payment_request_id,account_id,number,amount_cents,paid_at,method,bank_receipt_url,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,now(),'对公转账',$8,$9) RETURNING id`, params: [request.companyId, request.projectId, request.payableId, request.id, request.accountId, number, request.amountCents, bankReceiptUrl.trim(), user.id] },
    { query: "UPDATE payables SET paid_cents=paid_cents+$1,status=CASE WHEN paid_cents+$1>=amount_cents THEN '已付' ELSE '部分付款' END,version=version+1,updated_at=now(),updated_by=$2 WHERE id=$3", params: [request.amountCents, user.id, request.payableId] },
    { query: "UPDATE company_accounts SET balance_cents=balance_cents-$1,updated_at=now(),updated_by=$2 WHERE id=$3", params: [request.amountCents, user.id, request.accountId] },
    { query: "UPDATE payment_requests SET status='已付款',version=version+1,updated_at=now(),updated_by=$1 WHERE id=$2", params: [user.id, request.id] },
  ]);
  const payment = results[0][0];
  await writeAudit({ user, companyId: request.companyId, projectId: request.projectId, objectType: "payment", objectId: payment.id, action: "PAY", after: { number, amountCents: request.amountCents, paymentRequestId: request.id } });
  return { id: payment.id, number };
}

export async function getPurchaseApprovalDetail(requestId: number, user: SessionUser) {
  assertCan(user, "purchase-requests", "read");
  const [header] = await sqlQuery<Record<string, unknown>>(`SELECT r.id,r.company_id AS "companyId",r.project_id AS "projectId",r.number,r.payment_type AS "paymentType",r.amount_cents AS "amountCents",r.reason,r.status,r.created_at::text AS "createdAt",r.attachment_url AS "attachmentUrl",c.name AS "companyName",p.name AS "projectName",s.name AS "supplierName",u.name AS "requesterName" FROM purchase_requests r JOIN companies c ON c.id=r.company_id JOIN projects p ON p.id=r.project_id JOIN suppliers s ON s.id=r.supplier_id JOIN users u ON u.id=r.requested_by WHERE r.id=$1 AND NOT r.is_void`, [requestId]);
  if (!header) throw new Error("采购申请不存在");
  await assertWorkflowAccess(user, Number(header.companyId), Number(header.projectId), "purchase");
  const items = await sqlQuery<Record<string, unknown>>(`SELECT i.id,s.id AS "skuId",s.code AS "skuCode",s.name AS "skuName",s.image_url AS "imageUrl",s.quantity,s.unit,s.budget_unit_cents AS "budgetUnitCents",i.unit_price_cents AS "finalUnitCents",i.amount_cents AS "itemAmountCents",(i.unit_price_cents-s.budget_unit_cents)*i.quantity AS "overBudgetCents",CASE WHEN s.budget_unit_cents=0 THEN 0 ELSE round((i.unit_price_cents-s.budget_unit_cents)*100.0/s.budget_unit_cents,2) END AS "overBudgetPercent" FROM purchase_request_items i JOIN skus s ON s.id=i.sku_id WHERE i.request_id=$1 ORDER BY i.id`, [requestId]);
  const quotes = await sqlQuery<Record<string, unknown>>(`SELECT q.sku_id AS "skuId",sup.name AS "supplierName",q.unit_price_cents AS "unitPriceCents",q.freight_cents AS "freightCents",q.install_cents AS "installCents",q.tax_rate_bps AS "taxRateBps",q.payment_terms AS "paymentTerms",q.lead_days AS "leadDays",q.status,q.attachment_url AS "attachmentUrl" FROM supplier_quotes q JOIN suppliers sup ON sup.id=q.supplier_id WHERE q.sku_id IN (SELECT sku_id FROM purchase_request_items WHERE request_id=$1) ORDER BY q.sku_id,q.unit_price_cents`, [requestId]);
  const approvals = await sqlQuery<Record<string, unknown>>(`SELECT a.decision,a.comment,a.decided_at::text AS "decidedAt",u.name AS "approverName" FROM purchase_approvals a JOIN users u ON u.id=a.approver_id WHERE a.request_id=$1 ORDER BY a.decided_at DESC`, [requestId]);
  return { header, items, quotes, approvals };
}

export async function getPaymentApprovalDetail(requestId: number, user: SessionUser) {
  assertCan(user, "payment-requests", "read");
  const [header] = await sqlQuery<Record<string, unknown>>(`SELECT r.id,r.company_id AS "companyId",r.project_id AS "projectId",r.number,r.amount_cents AS "requestAmountCents",r.reason,r.status,r.created_at::text AS "createdAt",p.name AS "projectName",s.name AS "supplierName",po.number AS "orderNumber",y.number AS "payableNumber",y.amount_cents AS "payableAmountCents",y.paid_cents AS "paidCents",(y.amount_cents-y.paid_cents-r.amount_cents)::float8 AS "remainingAfterCents",y.invoice_status AS "invoiceStatus",GREATEST(y.amount_cents-COALESCE((SELECT sum(ia.amount_cents) FROM invoice_allocations ia WHERE ia.payable_id=y.id),0),0)::float8 AS "missingInvoiceCents",a.name AS "accountName",a.balance_cents AS "accountBalanceCents",(a.balance_cents-r.amount_cents)::float8 AS "accountBalanceAfterCents",u.name AS "requesterName" FROM payment_requests r JOIN payables y ON y.id=r.payable_id JOIN purchase_orders po ON po.id=y.purchase_order_id JOIN projects p ON p.id=r.project_id JOIN suppliers s ON s.id=y.supplier_id JOIN company_accounts a ON a.id=r.account_id JOIN users u ON u.id=r.requested_by WHERE r.id=$1 AND NOT r.is_void`, [requestId]);
  if (!header) throw new Error("付款申请不存在");
  await assertWorkflowAccess(user, Number(header.companyId), Number(header.projectId), "payment");
  const canViewAccountBalance = user.role === "owner" || user.role === "finance";
  if (!canViewAccountBalance) {
    delete header.accountName;
    delete header.accountBalanceCents;
    delete header.accountBalanceAfterCents;
  }
  header.accountBalanceAccessible = canViewAccountBalance;
  const approvals = await sqlQuery<Record<string, unknown>>(`SELECT a.decision,a.comment,a.decided_at::text AS "decidedAt",u.name AS "approverName" FROM payment_approvals a JOIN users u ON u.id=a.approver_id WHERE a.payment_request_id=$1 ORDER BY a.decided_at DESC`, [requestId]);
  return { header, approvals };
}
