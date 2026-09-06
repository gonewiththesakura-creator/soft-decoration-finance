import { sqlQuery } from "@/db/client";
import type { SessionUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { buildCashflowForecast, groupCashflowByWeek } from "./cashflow";
import { calculateProjectHealth, percentage } from "./health";
import { analyticsScope } from "./scope";
import type { BucketPoint, CashflowDrilldownItem, ExecutiveDashboardDetails } from "./types";
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

type DatedCashflowDrilldownItem = CashflowDrilldownItem & { date: string };

type OverduePresentationRow = {
  customerCount: number;
  maxCustomerName: string | null;
  maxAmountCents: number;
  longestOverdueDays: number;
};

type MissingInvoicePresentationRow = {
  supplierCount: number;
  maxSupplierName: string | null;
  maxAmountCents: number;
};

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
  const accountScope = analyticsScope(user, selectedCompanyId, "a");
  const balanceAccess = user.role === "owner" || user.role === "finance";
  const receivableAccess = can(user, "receivables");
  const payableAccess = can(user, "payables");
  const financialProjectAccess = user.role === "owner" || user.role === "finance" || user.role === "project_manager";
  const operationalProjectAccess = can(user, "purchase-orders") && can(user, "budgets");

  const [dailyFlows, projectRows, receivableAgingRows, payableMaturityRows, topAccounts, overduePresentationRows, missingInvoicePresentationRows, topReceivables, topPayables] = await Promise.all([
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
    receivableAccess ? sqlQuery<OrderedBucket>(`SELECT CASE
        WHEN rp.due_date>=current_date THEN '未到期' WHEN rp.due_date>=current_date-interval '30 day' THEN '0-30 天'
        WHEN rp.due_date>=current_date-interval '60 day' THEN '31-60 天' WHEN rp.due_date>=current_date-interval '90 day' THEN '61-90 天' ELSE '90+ 天' END AS label,
      CASE WHEN rp.due_date>=current_date THEN 0 WHEN rp.due_date>=current_date-interval '30 day' THEN 1 WHEN rp.due_date>=current_date-interval '60 day' THEN 2 WHEN rp.due_date>=current_date-interval '90 day' THEN 3 ELSE 4 END AS "sortOrder",
      sum(rp.amount_cents-rp.received_cents)::float8 AS "valueCents" FROM receivable_plans rp WHERE ${receivableScope.clause} AND NOT rp.is_void AND NOT rp.is_warranty AND rp.received_cents<rp.amount_cents GROUP BY label,"sortOrder" ORDER BY "sortOrder"`, receivableScope.params) : Promise.resolve([] as OrderedBucket[]),
    payableAccess ? sqlQuery<OrderedBucket>(`SELECT CASE
        WHEN y.due_date<current_date THEN '已逾期' WHEN y.due_date<=current_date+interval '7 day' THEN '7 天内'
        WHEN y.due_date<=current_date+interval '15 day' THEN '8-15 天' WHEN y.due_date<=current_date+interval '30 day' THEN '16-30 天' ELSE '30 天以后' END AS label,
      CASE WHEN y.due_date<current_date THEN 0 WHEN y.due_date<=current_date+interval '7 day' THEN 1 WHEN y.due_date<=current_date+interval '15 day' THEN 2 WHEN y.due_date<=current_date+interval '30 day' THEN 3 ELSE 4 END AS "sortOrder",
      sum(y.amount_cents-y.paid_cents)::float8 AS "valueCents" FROM payables y WHERE ${payableScope.clause} AND NOT y.is_void AND y.paid_cents<y.amount_cents GROUP BY label,"sortOrder" ORDER BY "sortOrder"`, payableScope.params) : Promise.resolve([] as OrderedBucket[]),
    balanceAccess && startingBalanceCents !== null ? sqlQuery<NonNullable<ExecutiveDashboardDetails["topAccount"]>>(`SELECT a.id,a.name AS "accountName",c.name AS "companyName",a.balance_cents::float8 AS "balanceCents"
      FROM company_accounts a JOIN companies c ON c.id=a.company_id
      WHERE ${accountScope.clause} AND a.status='active'
      ORDER BY a.balance_cents DESC,a.id LIMIT 1`, accountScope.params) : Promise.resolve([]),
    receivableAccess ? sqlQuery<OverduePresentationRow>(`WITH overdue_customers AS (
        SELECT c.id,c.name,sum(rp.amount_cents-rp.received_cents)::float8 AS amount_cents,max((current_date-rp.due_date::date)::int)::int AS longest_days
        FROM receivable_plans rp JOIN projects p ON p.id=rp.project_id JOIN customers c ON c.id=p.customer_id
        WHERE ${receivableScope.clause} AND NOT rp.is_void AND NOT rp.is_warranty AND rp.received_cents<rp.amount_cents AND rp.due_date<current_date
        GROUP BY c.id,c.name
      )
      SELECT count(*)::int AS "customerCount",(array_agg(name ORDER BY amount_cents DESC,id))[1] AS "maxCustomerName",
        COALESCE(max(amount_cents),0)::float8 AS "maxAmountCents",COALESCE(max(longest_days),0)::int AS "longestOverdueDays"
      FROM overdue_customers`, receivableScope.params) : Promise.resolve([] as OverduePresentationRow[]),
    payableAccess ? sqlQuery<MissingInvoicePresentationRow>(`WITH supplier_gaps AS (
        SELECT s.id,s.name,sum(GREATEST(y.amount_cents-COALESCE((SELECT sum(ia.amount_cents) FROM invoice_allocations ia WHERE ia.payable_id=y.id),0),0))::float8 AS amount_cents
        FROM payables y JOIN suppliers s ON s.id=y.supplier_id
        WHERE ${payableScope.clause} AND NOT y.is_void
        GROUP BY s.id,s.name
        HAVING sum(GREATEST(y.amount_cents-COALESCE((SELECT sum(ia.amount_cents) FROM invoice_allocations ia WHERE ia.payable_id=y.id),0),0))>0
      )
      SELECT count(*)::int AS "supplierCount",(array_agg(name ORDER BY amount_cents DESC,id))[1] AS "maxSupplierName",
        COALESCE(max(amount_cents),0)::float8 AS "maxAmountCents"
      FROM supplier_gaps`, payableScope.params) : Promise.resolve([] as MissingInvoicePresentationRow[]),
    startingBalanceCents !== null && receivableAccess ? sqlQuery<DatedCashflowDrilldownItem>(`SELECT DISTINCT ON (rp.due_date::date) rp.due_date::date::text AS date,rp.id,rp.project_id AS "projectId",p.name AS "projectName",c.name AS counterparty,
        (rp.amount_cents-rp.received_cents)::float8 AS "amountCents"
      FROM receivable_plans rp JOIN projects p ON p.id=rp.project_id JOIN customers c ON c.id=p.customer_id
      WHERE ${receivableScope.clause} AND NOT rp.is_void AND NOT rp.is_warranty AND rp.received_cents<rp.amount_cents
        AND rp.due_date::date BETWEEN current_date AND current_date+interval '29 day'
      ORDER BY rp.due_date::date,"amountCents" DESC,rp.id`, receivableScope.params) : Promise.resolve([] as DatedCashflowDrilldownItem[]),
    startingBalanceCents !== null && payableAccess ? sqlQuery<DatedCashflowDrilldownItem>(`SELECT DISTINCT ON (y.due_date::date) y.due_date::date::text AS date,y.id,y.project_id AS "projectId",p.name AS "projectName",s.name AS counterparty,
        (y.amount_cents-y.paid_cents)::float8 AS "amountCents"
      FROM payables y JOIN projects p ON p.id=y.project_id JOIN suppliers s ON s.id=y.supplier_id
      WHERE ${payableScope.clause} AND NOT y.is_void AND y.paid_cents<y.amount_cents
        AND y.due_date::date BETWEEN current_date AND current_date+interval '29 day'
      ORDER BY y.due_date::date,"amountCents" DESC,y.id`, payableScope.params) : Promise.resolve([] as DatedCashflowDrilldownItem[]),
  ]);

  const topReceivableByDate = new Map(topReceivables.map(({ date, ...item }) => [date, item]));
  const topPayableByDate = new Map(topPayables.map(({ date, ...item }) => [date, item]));
  const cashflow = startingBalanceCents === null ? [] : buildCashflowForecast(startingBalanceCents, dailyFlows).map((point) => ({
    ...point,
    topReceivable: topReceivableByDate.get(point.date) ?? null,
    topPayable: topPayableByDate.get(point.date) ?? null,
    riskMessage: point.balanceCents < 0
      ? "预计余额低于 0，需提前安排回款或调整付款"
      : point.payableCents > point.receivableCents && point.payableCents > 0
        ? "当日预计付款高于收款，注意资金净流出"
        : null,
  }));
  const allProjectHealth = operationalProjectAccess ? projectRows.map((row) => {
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
  }).sort((a, b) => a.score - b.score) : [];
  const projectHealth = allProjectHealth.slice(0, 6);

  const executiveDetails: ExecutiveDashboardDetails = {
    topAccount: balanceAccess ? topAccounts[0] ?? null : null,
    overdue: receivableAccess ? overduePresentationRows[0] ?? { customerCount: 0, maxCustomerName: null, maxAmountCents: 0, longestOverdueDays: 0 } : null,
    missingInvoices: payableAccess ? missingInvoicePresentationRows[0] ?? { supplierCount: 0, maxSupplierName: null, maxAmountCents: 0 } : null,
  };

  return {
    cashflow,
    weeklyCashflow: groupCashflowByWeek(cashflow),
    projectHealth,
    projectHealthAccessible: operationalProjectAccess,
    projectRiskCount: operationalProjectAccess ? allProjectHealth.filter((project) => project.tone !== "healthy").length : null,
    receivableAging: receivableAgingRows.map(({ label, valueCents }) => ({ label, valueCents })),
    payableMaturity: payableMaturityRows.map(({ label, valueCents }) => ({ label, valueCents })),
    executiveDetails,
  };
}
