import { sqlQuery } from "@/db/client";
import type { SessionUser } from "@/lib/auth";

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
  const summaryParams: unknown[] = [];
  const scoped = (alias: string, projectExpression: string) => {
    const parts: string[] = [];
    if (scope !== null) { const existing = summaryParams.findIndex((value) => value === scope); const index = existing >= 0 ? existing + 1 : (summaryParams.push(scope), summaryParams.length); parts.push(`${alias}.company_id=$${index}`); }
    if (restrictedProjects) { const existing = summaryParams.findIndex((value) => value === user.id); const index = existing >= 0 ? existing + 1 : (summaryParams.push(user.id), summaryParams.length); parts.push(`EXISTS (SELECT 1 FROM project_members pm_dash WHERE pm_dash.project_id=${projectExpression} AND pm_dash.user_id=$${index})`); }
    return parts.length ? parts.join(" AND ") : "TRUE";
  };
  const accountCondition = user.role === "owner" || user.role === "finance" ? (scope === null ? "TRUE" : `a.company_id=$${summaryParams.findIndex((value) => value === scope) + 1 || (summaryParams.push(scope), summaryParams.length)}`) : "FALSE";
  const planCondition = scoped("rp", "rp.project_id");
  const payableCondition = scoped("y", "y.project_id");
  const requestCondition = scoped("r", "r.project_id");
  const projectCondition = scoped("p", "p.id");

  const [summary] = await sqlQuery<{
    balance: number; receivable30: number; payable30: number; pendingPurchases: number;
    pendingPayments: number; activeProjects: number; overdueReceivables: number; missingInvoice: number;
  }>(`SELECT
    (SELECT COALESCE(sum(a.balance_cents),0)::float8 FROM company_accounts a WHERE ${accountCondition} AND a.status='active') AS balance,
    (SELECT COALESCE(sum(rp.amount_cents-rp.received_cents),0)::float8 FROM receivable_plans rp WHERE ${planCondition} AND NOT rp.is_void AND NOT rp.is_warranty AND rp.due_date BETWEEN now() AND now()+interval '30 day') AS "receivable30",
    (SELECT COALESCE(sum(y.amount_cents-y.paid_cents),0)::float8 FROM payables y WHERE ${payableCondition} AND NOT y.is_void AND y.due_date BETWEEN now() AND now()+interval '30 day') AS "payable30",
    (SELECT count(*)::int FROM purchase_requests r WHERE ${requestCondition} AND NOT r.is_void AND r.status='待审批') AS "pendingPurchases",
    (SELECT count(*)::int FROM payment_requests r WHERE ${requestCondition} AND NOT r.is_void AND r.status='待审批') AS "pendingPayments",
    (SELECT count(*)::int FROM projects p WHERE ${projectCondition} AND p.status IN ('待启动','执行中','待验收','待审计','待质保关闭')) AS "activeProjects",
    (SELECT COALESCE(sum(rp.amount_cents-rp.received_cents),0)::float8 FROM receivable_plans rp WHERE ${planCondition} AND NOT rp.is_void AND NOT rp.is_warranty AND rp.due_date < now() AND rp.received_cents < rp.amount_cents) AS "overdueReceivables",
    (SELECT COALESCE(sum(GREATEST(y.amount_cents-COALESCE((SELECT sum(ia.amount_cents) FROM invoice_allocations ia WHERE ia.payable_id=y.id),0),0)),0)::float8 FROM payables y WHERE ${payableCondition} AND NOT y.is_void) AS "missingInvoice"`, summaryParams);

  const balances = await sqlQuery<{ id: number; name: string; balanceCents: number; accountCount: number }>(
    `SELECT c.id, c.name, COALESCE(sum(a.balance_cents),0)::float8 AS "balanceCents", count(a.id)::int AS "accountCount"
     FROM companies c LEFT JOIN company_accounts a ON a.company_id=c.id AND a.status='active'
     WHERE ${restrictedProjects ? "FALSE" : scope === null ? "TRUE" : "c.id=$1"} GROUP BY c.id, c.name ORDER BY c.id`, restrictedProjects || scope === null ? [] : [scope],
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
  const cashflow = await sqlQuery<{ dueDate: string; type: string; projectName: string; counterparty: string; amountCents: number; status: string }>(
    `SELECT * FROM (
       SELECT rp.due_date::text AS "dueDate",'应收' AS type,p.name AS "projectName",c.name AS counterparty,(rp.amount_cents-rp.received_cents)::float8 AS "amountCents",rp.status
       FROM receivable_plans rp JOIN projects p ON p.id=rp.project_id JOIN customers c ON c.id=p.customer_id
       WHERE ${cashPlanCondition} AND NOT rp.is_void AND NOT rp.is_warranty AND rp.received_cents<rp.amount_cents AND rp.due_date<=now()+interval '30 day'
       UNION ALL
       SELECT y.due_date::text,'应付',p.name,s.name,(y.amount_cents-y.paid_cents)::float8,y.status
       FROM payables y JOIN projects p ON p.id=y.project_id JOIN suppliers s ON s.id=y.supplier_id
       WHERE ${cashPayableCondition} AND NOT y.is_void AND y.paid_cents<y.amount_cents AND y.due_date<=now()+interval '30 day'
     ) f ORDER BY "dueDate" ASC LIMIT 12`, cashScopeParams,
  );
  const pendingScopeParams: unknown[] = [];
  const pendingScoped = (alias: string) => {
    const conditions: string[] = [];
    if (scope !== null) { const existing = pendingScopeParams.findIndex((value) => value === scope); const index = existing >= 0 ? existing + 1 : (pendingScopeParams.push(scope), pendingScopeParams.length); conditions.push(`${alias}.company_id=$${index}`); }
    if (restrictedProjects) { const existing = pendingScopeParams.findIndex((value) => value === user.id); const index = existing >= 0 ? existing + 1 : (pendingScopeParams.push(user.id), pendingScopeParams.length); conditions.push(`EXISTS (SELECT 1 FROM project_members pm_pending WHERE pm_pending.project_id=${alias}.project_id AND pm_pending.user_id=$${index})`); }
    return conditions.length ? conditions.join(" AND ") : "TRUE";
  };
  const purchasePending = pendingScoped("r"); const paymentPending = pendingScoped("r");
  const pending = await sqlQuery<{ id: number; kind: string; number: string; projectName: string; amountCents: number; createdAt: string }>(
    `SELECT * FROM (
       SELECT r.id,'采购审批' AS kind,r.number,p.name AS "projectName",r.amount_cents AS "amountCents",r.created_at::text AS "createdAt"
       FROM purchase_requests r JOIN projects p ON p.id=r.project_id WHERE ${purchasePending} AND r.status='待审批' AND NOT r.is_void
       UNION ALL
       SELECT r.id,'付款审批',r.number,p.name,r.amount_cents,r.created_at::text
       FROM payment_requests r JOIN projects p ON p.id=r.project_id WHERE ${paymentPending} AND r.status='待审批' AND NOT r.is_void
     ) q ORDER BY "createdAt" DESC LIMIT 8`, pendingScopeParams,
  );
  return { summary, balances, overBudget, cashflow, pending };
}
