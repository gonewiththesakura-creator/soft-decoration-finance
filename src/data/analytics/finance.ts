import { sqlQuery } from "@/db/client";
import type { SessionUser } from "@/lib/auth";
import { assertCan } from "@/lib/permissions";
import { buildCashflowForecast, projectedBalance } from "./cashflow";
import { analyticsScope } from "./scope";
import type { BucketPoint } from "./types";
import type { DailyFlow } from "./cashflow";

function fillBuckets(rows: BucketPoint[], labels: string[]) {
  const values = new Map(rows.map((row) => [row.label, Number(row.valueCents)]));
  return labels.map((label) => ({ label, valueCents: values.get(label) ?? 0 }));
}
export async function getFinanceAnalytics(user: SessionUser, selectedCompanyId: number | null, startingBalanceCents: number) {
  assertCan(user, "accounts", "read");
  const flowScope = analyticsScope(user, selectedCompanyId, "source", "source.project_id");
  const receivableScope = analyticsScope(user, selectedCompanyId, "rp", "rp.project_id");
  const payableScope = analyticsScope(user, selectedCompanyId, "y", "y.project_id");
  const [dailyFlows, agingRows, maturityRows] = await Promise.all([
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
    sqlQuery<BucketPoint>(`SELECT CASE
      WHEN rp.due_date>=current_date THEN '未到期'
      WHEN rp.due_date>=current_date-interval '30 day' THEN '0-30天'
      WHEN rp.due_date>=current_date-interval '60 day' THEN '31-60天'
      WHEN rp.due_date>=current_date-interval '90 day' THEN '61-90天'
      ELSE '90天以上' END AS label,
      sum(rp.amount_cents-rp.received_cents)::float8 AS "valueCents"
    FROM receivable_plans rp WHERE ${receivableScope.clause} AND NOT rp.is_void AND NOT rp.is_warranty AND rp.received_cents<rp.amount_cents GROUP BY label`, receivableScope.params),
    sqlQuery<BucketPoint>(`SELECT CASE
      WHEN y.due_date<=current_date+interval '7 day' THEN '7天内'
      WHEN y.due_date<=current_date+interval '15 day' THEN '8-15天'
      WHEN y.due_date<=current_date+interval '30 day' THEN '16-30天'
      ELSE '30天以后' END AS label,
      sum(y.amount_cents-y.paid_cents)::float8 AS "valueCents"
    FROM payables y WHERE ${payableScope.clause} AND NOT y.is_void AND y.paid_cents<y.amount_cents GROUP BY label`, payableScope.params),
  ]);
  const cashflow = buildCashflowForecast(startingBalanceCents, dailyFlows);
  return {
    cashflow,
    balanceToday: startingBalanceCents,
    balance7: projectedBalance(cashflow, 7, startingBalanceCents),
    balance30: projectedBalance(cashflow, 30, startingBalanceCents),
    receivableAging: fillBuckets(agingRows, ["未到期", "0-30天", "31-60天", "61-90天", "90天以上"]),
    payableMaturity: fillBuckets(maturityRows, ["7天内", "8-15天", "16-30天", "30天以后"]),
  };
}
