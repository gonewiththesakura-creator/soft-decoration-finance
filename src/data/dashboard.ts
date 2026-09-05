import { sqlQuery } from "@/db/client";
import type { SessionUser } from "@/lib/auth";
import { can } from "@/lib/permissions";

function scopeClause(scope: number | null, alias: string, user: SessionUser, projectExpression?: string) {
  const params: unknown[] = []; const conditions: string[] = [];
  if (scope !== null) { params.push(scope); conditions.push(`${alias}.company_id=$${params.length}`); }
  if ((user.role === "project_manager" || user.role === "designer") && projectExpression) {
    params.push(user.id); conditions.push(`EXISTS (SELECT 1 FROM project_members pm_dash WHERE pm_dash.project_id=${projectExpression} AND pm_dash.user_id=$${params.length})`);
  }
  return { sql: conditions.length ? conditions.join(" AND ") : "TRUE", params };
}

export async function getDashboardData(user: SessionUser, scope: number | null) {
  const projectScope = scopeClause(scope, "p", user, "p.id");
  const restrictedProjects = user.role === "project_manager" || user.role === "designer";
  const balanceAccessible = user.role === "owner" || user.role === "finance";
  const receivableAccessible = can(user, "receivables");
  const payableAccessible = can(user, "payables");
  const purchaseRequestAccessible = can(user, "purchase-requests");
  const paymentApprovalAccessible = can(user, "payment-requests");
  const summaryParams: unknown[] = [];
  const scoped = (alias: string, projectExpression: string) => {
    const parts: string[] = [];
    if (scope !== null) { const existing = summaryParams.findIndex((value) => value === scope); const index = existing >= 0 ? existing + 1 : (summaryParams.push(scope), summaryParams.length); parts.push(`${alias}.company_id=$${index}`); }
    if (restrictedProjects) { const existing = summaryParams.findIndex((value) => value === user.id); const index = existing >= 0 ? existing + 1 : (summaryParams.push(user.id), summaryParams.length); parts.push(`EXISTS (SELECT 1 FROM project_members pm_dash WHERE pm_dash.project_id=${projectExpression} AND pm_dash.user_id=$${index})`); }
    return parts.length ? parts.join(" AND ") : "TRUE";
  };
  const accountCondition = balanceAccessible ? (scope === null ? "TRUE" : `a.company_id=$${summaryParams.findIndex((value) => value === scope) + 1 || (summaryParams.push(scope), summaryParams.length)}`) : "FALSE";
  const planCondition = scoped("rp", "rp.project_id");
  const payableCondition = scoped("y", "y.project_id");
  const requestCondition = scoped("r", "r.project_id");
  const projectCondition = scoped("p", "p.id");
  const receivableSummaryCondition = receivableAccessible ? planCondition : "FALSE";
  const payableSummaryCondition = payableAccessible ? payableCondition : "FALSE";
  const purchaseSummaryCondition = purchaseRequestAccessible ? requestCondition : "FALSE";
  const paymentSummaryCondition = paymentApprovalAccessible ? requestCondition : "FALSE";

  const [rawSummary] = await sqlQuery<{
    balance: number; receivable30: number; payable30: number; pendingPurchases: number;
    pendingPurchaseCents: number; pendingPayments: number; pendingPaymentCents: number;
    activeProjects: number; overdueReceivables: number; missingInvoice: number;
  }>(`SELECT
    (SELECT COALESCE(sum(a.balance_cents),0)::float8 FROM company_accounts a WHERE ${accountCondition} AND a.status='active') AS balance,
    (SELECT COALESCE(sum(rp.amount_cents-rp.received_cents),0)::float8 FROM receivable_plans rp WHERE ${receivableSummaryCondition} AND NOT rp.is_void AND NOT rp.is_warranty AND rp.due_date BETWEEN now() AND now()+interval '30 day') AS "receivable30",
    (SELECT COALESCE(sum(y.amount_cents-y.paid_cents),0)::float8 FROM payables y WHERE ${payableSummaryCondition} AND NOT y.is_void AND y.due_date BETWEEN now() AND now()+interval '30 day') AS "payable30",
    (SELECT count(*)::int FROM purchase_requests r WHERE ${purchaseSummaryCondition} AND NOT r.is_void AND r.status='待审批') AS "pendingPurchases",
    (SELECT COALESCE(sum(r.amount_cents),0)::float8 FROM purchase_requests r WHERE ${purchaseSummaryCondition} AND NOT r.is_void AND r.status='待审批') AS "pendingPurchaseCents",
    (SELECT count(*)::int FROM payment_requests r WHERE ${paymentSummaryCondition} AND NOT r.is_void AND r.status='待审批') AS "pendingPayments",
    (SELECT COALESCE(sum(r.amount_cents),0)::float8 FROM payment_requests r WHERE ${paymentSummaryCondition} AND NOT r.is_void AND r.status='待审批') AS "pendingPaymentCents",
    (SELECT count(*)::int FROM projects p WHERE ${projectCondition} AND p.status IN ('待启动','执行中','待验收','待审计','待质保关闭')) AS "activeProjects",
    (SELECT COALESCE(sum(rp.amount_cents-rp.received_cents),0)::float8 FROM receivable_plans rp WHERE ${receivableSummaryCondition} AND NOT rp.is_void AND NOT rp.is_warranty AND rp.due_date < now() AND rp.received_cents < rp.amount_cents) AS "overdueReceivables",
    (SELECT COALESCE(sum(GREATEST(y.amount_cents-COALESCE((SELECT sum(ia.amount_cents) FROM invoice_allocations ia WHERE ia.payable_id=y.id),0),0)),0)::float8 FROM payables y WHERE ${payableSummaryCondition} AND NOT y.is_void) AS "missingInvoice"`, summaryParams);

  const summary = {
    balance: balanceAccessible ? Number(rawSummary.balance) : null,
    balanceAccessible,
    receivable30: receivableAccessible ? Number(rawSummary.receivable30) : null,
    overdueReceivables: receivableAccessible ? Number(rawSummary.overdueReceivables) : null,
    receivableAccessible,
    payable30: payableAccessible ? Number(rawSummary.payable30) : null,
    missingInvoice: payableAccessible ? Number(rawSummary.missingInvoice) : null,
    payableAccessible,
    pendingPurchases: purchaseRequestAccessible ? Number(rawSummary.pendingPurchases) : null,
    pendingPurchaseCents: purchaseRequestAccessible ? Number(rawSummary.pendingPurchaseCents) : null,
    purchaseRequestAccessible,
    pendingPayments: paymentApprovalAccessible ? Number(rawSummary.pendingPayments) : null,
    pendingPaymentCents: paymentApprovalAccessible ? Number(rawSummary.pendingPaymentCents) : null,
    paymentApprovalAccessible,
    activeProjects: Number(rawSummary.activeProjects),
  };

  const balances = await sqlQuery<{ id: number; name: string; balanceCents: number; accountCount: number }>(
    `SELECT c.id, c.name, COALESCE(sum(a.balance_cents),0)::float8 AS "balanceCents", count(a.id)::int AS "accountCount"
     FROM companies c LEFT JOIN company_accounts a ON a.company_id=c.id AND a.status='active'
     WHERE ${!balanceAccessible || restrictedProjects ? "FALSE" : scope === null ? "TRUE" : "c.id=$1"} GROUP BY c.id, c.name ORDER BY c.id`, !balanceAccessible || restrictedProjects || scope === null ? [] : [scope],
  );
  const overBudget = await sqlQuery<{ id: number; code: string; name: string; budgetCents: number; orderedCents: number }>(
    `SELECT p.id,p.code,p.name,p.budget_cents AS "budgetCents",COALESCE(sum(po.amount_cents),0)::float8 AS "orderedCents"
     FROM projects p LEFT JOIN purchase_orders po ON po.project_id=p.id AND NOT po.is_void
     WHERE ${projectScope.sql} GROUP BY p.id,p.code,p.name,p.budget_cents
     HAVING COALESCE(sum(po.amount_cents),0)>p.budget_cents ORDER BY COALESCE(sum(po.amount_cents),0)-p.budget_cents DESC LIMIT 5`, projectScope.params,
  );
  const cashScopeParams: unknown[] = [];
  const cashScoped = (alias: string, projectExpression: string) => {
    const conditions: string[] = [];
    if (scope !== null) { const existing = cashScopeParams.findIndex((value) => value === scope); const index = existing >= 0 ? existing + 1 : (cashScopeParams.push(scope), cashScopeParams.length); conditions.push(`${alias}.company_id=$${index}`); }
    if (restrictedProjects) { const existing = cashScopeParams.findIndex((value) => value === user.id); const index = existing >= 0 ? existing + 1 : (cashScopeParams.push(user.id), cashScopeParams.length); conditions.push(`EXISTS (SELECT 1 FROM project_members pm_cash WHERE pm_cash.project_id=${projectExpression} AND pm_cash.user_id=$${index})`); }
    return conditions.length ? conditions.join(" AND ") : "TRUE";
  };
  const cashPlanCondition = cashScoped("rp", "rp.project_id"); const cashPayableCondition = cashScoped("y", "y.project_id");
  const cashflow = !receivableAccessible && !payableAccessible ? [] : await sqlQuery<{ id: number; projectId: number; dueDate: string; type: string; projectName: string; counterparty: string; amountCents: number; status: string }>(
    `SELECT * FROM (
       SELECT rp.id,rp.project_id AS "projectId",rp.due_date::text AS "dueDate",'应收' AS type,p.name AS "projectName",c.name AS counterparty,(rp.amount_cents-rp.received_cents)::float8 AS "amountCents",rp.status
       FROM receivable_plans rp JOIN projects p ON p.id=rp.project_id JOIN customers c ON c.id=p.customer_id
       WHERE ${receivableAccessible ? cashPlanCondition : "FALSE"} AND NOT rp.is_void AND NOT rp.is_warranty AND rp.received_cents<rp.amount_cents AND rp.due_date<=now()+interval '30 day'
       UNION ALL
       SELECT y.id,y.project_id,y.due_date::text,'应付',p.name,s.name,(y.amount_cents-y.paid_cents)::float8,y.status
       FROM payables y JOIN projects p ON p.id=y.project_id JOIN suppliers s ON s.id=y.supplier_id
       WHERE ${payableAccessible ? cashPayableCondition : "FALSE"} AND NOT y.is_void AND y.paid_cents<y.amount_cents AND y.due_date<=now()+interval '30 day'
     ) f ORDER BY "dueDate" ASC LIMIT 12`, cashScopeParams,
  );
  const pendingScopeParams: unknown[] = [];
  const pendingScoped = (alias: string) => {
    const conditions: string[] = [];
    if (scope !== null) { const existing = pendingScopeParams.findIndex((value) => value === scope); const index = existing >= 0 ? existing + 1 : (pendingScopeParams.push(scope), pendingScopeParams.length); conditions.push(`${alias}.company_id=$${index}`); }
    if (restrictedProjects) { const existing = pendingScopeParams.findIndex((value) => value === user.id); const index = existing >= 0 ? existing + 1 : (pendingScopeParams.push(user.id), pendingScopeParams.length); conditions.push(`EXISTS (SELECT 1 FROM project_members pm_pending WHERE pm_pending.project_id=${alias}.project_id AND pm_pending.user_id=$${index})`); }
    return conditions.length ? conditions.join(" AND ") : "TRUE";
  };
  const purchasePending = purchaseRequestAccessible ? pendingScoped("r") : "FALSE"; const paymentPending = paymentApprovalAccessible ? pendingScoped("r") : "FALSE";
  const pending = await sqlQuery<{ id: number; kind: string; number: string; projectName: string; amountCents: number; createdAt: string }>(
    `SELECT * FROM (
       SELECT r.id,'采购审批' AS kind,r.number,p.name AS "projectName",r.amount_cents AS "amountCents",r.created_at::text AS "createdAt"
       FROM purchase_requests r JOIN projects p ON p.id=r.project_id WHERE ${purchasePending} AND r.status='待审批' AND NOT r.is_void
       UNION ALL
       SELECT r.id,'付款审批',r.number,p.name,r.amount_cents,r.created_at::text
       FROM payment_requests r JOIN projects p ON p.id=r.project_id WHERE ${paymentPending} AND r.status='待审批' AND NOT r.is_void
     ) q ORDER BY "createdAt" DESC LIMIT 8`, pendingScopeParams,
  );
  const overdueScope = scopeClause(scope, "rp", user, "rp.project_id");
  const overdue = receivableAccessible ? await sqlQuery<{ id: number; projectId: number; projectName: string; customerName: string; amountCents: number; dueDate: string; overdueDays: number }>(
    `SELECT rp.id,p.id AS "projectId",p.name AS "projectName",c.name AS "customerName",(rp.amount_cents-rp.received_cents)::float8 AS "amountCents",rp.due_date::text AS "dueDate",(current_date-rp.due_date::date)::int AS "overdueDays" FROM receivable_plans rp JOIN projects p ON p.id=rp.project_id JOIN customers c ON c.id=p.customer_id WHERE ${overdueScope.sql} AND NOT rp.is_void AND NOT rp.is_warranty AND rp.received_cents<rp.amount_cents AND rp.due_date<current_date ORDER BY "amountCents" DESC LIMIT 5`, overdueScope.params,
  ) : [];
  const missingScope = scopeClause(scope, "y", user, "y.project_id");
  const missingInvoiceSuppliers = payableAccessible ? await sqlQuery<{ supplierId: number; supplierName: string; amountCents: number; payableCount: number }>(
    `SELECT s.id AS "supplierId",s.name AS "supplierName",sum(GREATEST(y.amount_cents-COALESCE((SELECT sum(ia.amount_cents) FROM invoice_allocations ia WHERE ia.payable_id=y.id),0),0))::float8 AS "amountCents",count(*)::int AS "payableCount" FROM payables y JOIN suppliers s ON s.id=y.supplier_id WHERE ${missingScope.sql} AND NOT y.is_void GROUP BY s.id,s.name HAVING sum(GREATEST(y.amount_cents-COALESCE((SELECT sum(ia.amount_cents) FROM invoice_allocations ia WHERE ia.payable_id=y.id),0),0))>0 ORDER BY "amountCents" DESC LIMIT 5`, missingScope.params,
  ) : [];
  const [scopeCompany] = scope === null ? [] : await sqlQuery<{ name: string }>(`SELECT name FROM companies WHERE id=$1`, [scope]);
  return { summary, balances, overBudget, cashflow, pending, overdue, missingInvoiceSuppliers, scopeLabel: scopeCompany?.name ?? "集团汇总 · 全部公司" };
}
