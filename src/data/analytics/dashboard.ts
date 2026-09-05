import { sqlQuery } from "@/db/client";
import type { SessionUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { buildCashflowForecast, groupCashflowByWeek } from "./cashflow";
import { calculateProjectHealth, percentage } from "./health";
import { analyticsScope } from "./scope";
import type { BucketPoint } from "./types";
import type { DailyFlow } from "./cashflow";

type ProjectHealthRow = {
  id: number;
  name: string;
  contractCents: number;
  budgetCents: number;
  receivedCents: number;
  orderedCents: number;
  deliveredCents: number;
  payableCents: number;
  paidCents: number;
  purchaseInvoicedCents: number;
  overdueReceivableCents: number;
};

type OrderedBucket = BucketPoint & { sortOrder: number };

function calculateOperationalHealth(row: ProjectHealthRow) {
  const reasons: string[] = [];
  let penalty = 0;
  const overBudgetCents = Math.max(0, row.orderedCents - row.budgetCents);
  const deliveryRate = row.orderedCents > 0 ? row.deliveredCents / row.orderedCents : 1;
  if (overBudgetCents > 0) {
    penalty += Math.min(35, Math.max(12, row.budgetCents > 0 ? overBudgetCents / row.budgetCents * 35 : 35));
    reasons.push("采购已超预算");
  }
  if (deliveryRate < 0.4) { penalty += 16; reasons.push("交付进度偏低"); }
  else if (deliveryRate < 0.7) { penalty += 8; reasons.push("交付进度需关注"); }
  const score = Math.max(0, Math.min(100, Math.round(100 - penalty)));
  if (score >= 80) return { score, label: "稳健", tone: "healthy" as const, reasons };
  if (score >= 60) return { score, label: "关注", tone: "watch" as const, reasons };
  return { score, label: "风险", tone: "risk" as const, reasons };
}

export async function getDashboardAnalytics(user: SessionUser, selectedCompanyId: number | null, startingBalanceCents: number | null) {
  const flowScope = analyticsScope(user, selectedCompanyId, "source", "source.project_id");
  const projectScope = analyticsScope(user, selectedCompanyId, "p", "p.id");
  const receivableScope = analyticsScope(user, selectedCompanyId, "rp", "rp.project_id");
  const payableScope = analyticsScope(user, selectedCompanyId, "y", "y.project_id");
  const financialProjectAccess = user.role === "owner" || user.role === "finance" || user.role === "project_manager";
  const operationalProjectAccess = can(user, "purchase-orders") && can(user, "budgets");

  const [dailyFlows, projectRows, receivableAgingRows, payableMaturityRows] = await Promise.all([
    startingBalanceCents === null ? Promise.resolve([] as DailyFlow[]) : sqlQuery<DailyFlow>(`WITH days AS (
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
      (SELECT COALESCE(sum(po.delivered_cents),0)::float8 FROM purchase_orders po WHERE po.project_id=p.id AND NOT po.is_void) AS "deliveredCents",
      (SELECT COALESCE(sum(y.amount_cents),0)::float8 FROM payables y WHERE y.project_id=p.id AND NOT y.is_void) AS "payableCents",
      (SELECT COALESCE(sum(f.amount_cents),0)::float8 FROM payments f WHERE f.project_id=p.id AND NOT f.is_void) AS "paidCents",
      (SELECT COALESCE(sum(ia.amount_cents),0)::float8 FROM invoice_allocations ia JOIN invoices i ON i.id=ia.invoice_id WHERE ia.project_id=p.id AND i.direction='进项' AND NOT i.is_void) AS "purchaseInvoicedCents",
      (SELECT COALESCE(sum(rp.amount_cents-rp.received_cents),0)::float8 FROM receivable_plans rp WHERE rp.project_id=p.id AND NOT rp.is_void AND rp.due_date<current_date AND rp.received_cents<rp.amount_cents) AS "overdueReceivableCents"
    FROM projects p WHERE ${projectScope.clause} AND p.status NOT IN ('质保关闭','已取消') ORDER BY p.id`, projectScope.params),
    can(user, "receivables") ? sqlQuery<OrderedBucket>(`SELECT CASE
        WHEN rp.due_date>=current_date THEN '未到期' WHEN rp.due_date>=current_date-interval '30 day' THEN '0-30 天'
        WHEN rp.due_date>=current_date-interval '60 day' THEN '31-60 天' WHEN rp.due_date>=current_date-interval '90 day' THEN '61-90 天' ELSE '90+ 天' END AS label,
      CASE WHEN rp.due_date>=current_date THEN 0 WHEN rp.due_date>=current_date-interval '30 day' THEN 1 WHEN rp.due_date>=current_date-interval '60 day' THEN 2 WHEN rp.due_date>=current_date-interval '90 day' THEN 3 ELSE 4 END AS "sortOrder",
      sum(rp.amount_cents-rp.received_cents)::float8 AS "valueCents" FROM receivable_plans rp WHERE ${receivableScope.clause} AND NOT rp.is_void AND NOT rp.is_warranty AND rp.received_cents<rp.amount_cents GROUP BY label,"sortOrder" ORDER BY "sortOrder"`, receivableScope.params) : Promise.resolve([] as OrderedBucket[]),
    can(user, "payables") ? sqlQuery<OrderedBucket>(`SELECT CASE
        WHEN y.due_date<current_date THEN '已逾期' WHEN y.due_date<=current_date+interval '7 day' THEN '7 天内'
        WHEN y.due_date<=current_date+interval '15 day' THEN '8-15 天' WHEN y.due_date<=current_date+interval '30 day' THEN '16-30 天' ELSE '30 天以后' END AS label,
      CASE WHEN y.due_date<current_date THEN 0 WHEN y.due_date<=current_date+interval '7 day' THEN 1 WHEN y.due_date<=current_date+interval '15 day' THEN 2 WHEN y.due_date<=current_date+interval '30 day' THEN 3 ELSE 4 END AS "sortOrder",
      sum(y.amount_cents-y.paid_cents)::float8 AS "valueCents" FROM payables y WHERE ${payableScope.clause} AND NOT y.is_void AND y.paid_cents<y.amount_cents GROUP BY label,"sortOrder" ORDER BY "sortOrder"`, payableScope.params) : Promise.resolve([] as OrderedBucket[]),
  ]);

  const cashflow = startingBalanceCents === null ? [] : buildCashflowForecast(startingBalanceCents, dailyFlows);
  const projectHealth = operationalProjectAccess ? projectRows.map((row) => {
    const health = financialProjectAccess ? calculateProjectHealth(row) : calculateOperationalHealth(row);
    const common = {
      id: row.id,
      name: row.name,
      score: health.score,
      label: health.label,
      tone: health.tone,
      budgetRate: row.budgetCents > 0 ? Math.round(row.orderedCents / row.budgetCents * 100) : 0,
      procurementRate: percentage(row.deliveredCents, row.orderedCents),
      riskCount: health.reasons.length,
      reasons: health.reasons,
      budgetCents: row.budgetCents,
      orderedCents: row.orderedCents,
      overBudgetCents: Math.max(0, row.orderedCents - row.budgetCents),
    };
    return financialProjectAccess ? { ...common, collectionRate: percentage(row.receivedCents, row.contractCents), contractCents: row.contractCents, receivedCents: row.receivedCents, paidCents: row.paidCents } : common;
  }).sort((a, b) => a.score - b.score).slice(0, 6) : [];

  return {
    cashflow,
    weeklyCashflow: groupCashflowByWeek(cashflow),
    projectHealth,
    receivableAging: receivableAgingRows.map(({ label, valueCents }) => ({ label, valueCents })),
    payableMaturity: payableMaturityRows.map(({ label, valueCents }) => ({ label, valueCents })),
  };
}
