import { sqlQuery } from "@/db/client";
import type { SessionUser } from "@/lib/auth";
import { buildCashflowForecast, groupCashflowByWeek } from "./cashflow";
import { calculateProjectHealth, percentage } from "./health";
import { analyticsScope } from "./scope";
import type { DailyFlow } from "./cashflow";

type ProjectHealthRow = {
  id: number;
  name: string;
  contractCents: number;
  budgetCents: number;
  receivedCents: number;
  orderedCents: number;
  payableCents: number;
  paidCents: number;
  purchaseInvoicedCents: number;
  overdueReceivableCents: number;
};

export async function getDashboardAnalytics(user: SessionUser, selectedCompanyId: number | null, startingBalanceCents: number) {
  const flowScope = analyticsScope(user, selectedCompanyId, "source", "source.project_id");
  const projectScope = analyticsScope(user, selectedCompanyId, "p", "p.id");
  const [dailyFlows, projectRows] = await Promise.all([
    sqlQuery<DailyFlow>(`WITH days AS (
      SELECT generate_series(current_date,current_date+interval '29 day',interval '1 day')::date AS day
    ), flows AS (
      SELECT rp.company_id,rp.project_id,rp.due_date::date AS day,(rp.amount_cents-rp.received_cents)::float8 AS receivable,0::float8 AS payable
      FROM receivable_plans rp WHERE NOT rp.is_void AND NOT rp.is_warranty AND rp.received_cents<rp.amount_cents
      UNION ALL
      SELECT y.company_id,y.project_id,y.due_date::date,0::float8,(y.amount_cents-y.paid_cents)::float8
      FROM payables y WHERE NOT y.is_void AND y.paid_cents<y.amount_cents
    )
    SELECT d.day::text AS date,COALESCE(sum(source.receivable),0)::float8 AS "receivableCents",COALESCE(sum(source.payable),0)::float8 AS "payableCents"
    FROM days d LEFT JOIN flows source ON source.day=d.day AND ${flowScope.clause}
    GROUP BY d.day ORDER BY d.day`, flowScope.params),
    sqlQuery<ProjectHealthRow>(`SELECT p.id,p.name,p.current_contract_cents::float8 AS "contractCents",p.budget_cents::float8 AS "budgetCents",
      (SELECT COALESCE(sum(r.amount_cents),0)::float8 FROM receipts r WHERE r.project_id=p.id AND NOT r.is_void) AS "receivedCents",
      (SELECT COALESCE(sum(po.amount_cents),0)::float8 FROM purchase_orders po WHERE po.project_id=p.id AND NOT po.is_void) AS "orderedCents",
      (SELECT COALESCE(sum(y.amount_cents),0)::float8 FROM payables y WHERE y.project_id=p.id AND NOT y.is_void) AS "payableCents",
      (SELECT COALESCE(sum(f.amount_cents),0)::float8 FROM payments f WHERE f.project_id=p.id AND NOT f.is_void) AS "paidCents",
      (SELECT COALESCE(sum(ia.amount_cents),0)::float8 FROM invoice_allocations ia JOIN invoices i ON i.id=ia.invoice_id WHERE ia.project_id=p.id AND i.direction='进项' AND NOT i.is_void) AS "purchaseInvoicedCents",
      (SELECT COALESCE(sum(rp.amount_cents-rp.received_cents),0)::float8 FROM receivable_plans rp WHERE rp.project_id=p.id AND NOT rp.is_void AND rp.due_date<current_date AND rp.received_cents<rp.amount_cents) AS "overdueReceivableCents"
    FROM projects p WHERE ${projectScope.clause} AND p.status NOT IN ('质保关闭','已取消') ORDER BY p.id`, projectScope.params),
  ]);

  const cashflow = buildCashflowForecast(startingBalanceCents, dailyFlows);
  const projectHealth = projectRows.map((row) => ({
    id: row.id,
    name: row.name,
    budgetRate: row.budgetCents > 0 ? Math.round(row.orderedCents / row.budgetCents * 100) : 0,
    collectionRate: percentage(row.receivedCents, row.contractCents),
    ...calculateProjectHealth(row),
  })).sort((a, b) => a.score - b.score).slice(0, 6);

  return { cashflow, weeklyCashflow: groupCashflowByWeek(cashflow), projectHealth };
}
