import { sqlQuery } from "@/db/client";

type ProjectDailyFlow = { date: string; receivedCents: number; paidCents: number };

export async function getProjectAnalytics(projectId: number) {
  const [daily, categories, stages] = await Promise.all([
    sqlQuery<ProjectDailyFlow>(`SELECT event_date::text AS date,sum(received)::float8 AS "receivedCents",sum(paid)::float8 AS "paidCents" FROM (
      SELECT received_at::date AS event_date,amount_cents::float8 AS received,0::float8 AS paid FROM receipts WHERE project_id=$1 AND NOT is_void
      UNION ALL
      SELECT paid_at::date,0::float8,amount_cents::float8 FROM payments WHERE project_id=$1 AND NOT is_void
    ) events GROUP BY event_date ORDER BY event_date`, [projectId]),
    sqlQuery<{ label: string; valueCents: number }>(`SELECT CASE
      WHEN category IN ('沙发','单椅','茶几','餐桌','家具') THEN '家具'
      WHEN category IN ('台灯','吊灯','壁灯','灯具') THEN '灯具'
      WHEN category IN ('窗帘','墙布') THEN '窗帘软饰'
      WHEN category IN ('摆件','地毯','饰品') THEN '饰品'
      WHEN category IN ('物流','运输') THEN '物流'
      WHEN category IN ('安装','施工') THEN '安装'
      ELSE '其他' END AS label,
      sum(quantity*COALESCE(final_unit_cents,budget_unit_cents)+freight_cents+install_cents)::float8 AS "valueCents"
    FROM skus WHERE project_id=$1 GROUP BY label ORDER BY "valueCents" DESC`, [projectId]),
    sqlQuery<{ label: string; count: number }>(`WITH sku_stage AS (
      SELECT s.id,CASE
        WHEN s.status IN ('已到货','已验收') OR EXISTS (
          SELECT 1 FROM purchase_request_items pri JOIN purchase_orders po ON po.request_id=pri.request_id AND NOT po.is_void JOIN goods_receipts gr ON gr.purchase_order_id=po.id AND NOT gr.is_void WHERE pri.sku_id=s.id
        ) THEN '已到货'
        WHEN s.status='已下单' OR EXISTS (
          SELECT 1 FROM purchase_request_items pri JOIN purchase_orders po ON po.request_id=pri.request_id AND NOT po.is_void WHERE pri.sku_id=s.id
        ) THEN '已下单'
        WHEN s.status='已核价' OR EXISTS (
          SELECT 1 FROM purchase_request_items pri JOIN purchase_requests pr ON pr.id=pri.request_id AND NOT pr.is_void AND pr.status IN ('草稿','待审批') WHERE pri.sku_id=s.id
        ) THEN '待审批'
        WHEN s.status='待核价' OR EXISTS (SELECT 1 FROM supplier_quotes q WHERE q.sku_id=s.id AND q.status='待核价') THEN '待核价'
        ELSE '待询价' END AS stage
      FROM skus s WHERE s.project_id=$1
    ) SELECT stage AS label,count(*)::int AS count FROM sku_stage GROUP BY stage`, [projectId]),
  ]);

  let receivedCents = 0;
  let paidCents = 0;
  const cashCurve = daily.map((row) => {
    receivedCents += Number(row.receivedCents);
    paidCents += Number(row.paidCents);
    const date = new Date(`${row.date}T00:00:00`);
    return {
      date: row.date,
      label: `${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")}`,
      receivedCents,
      paidCents,
    };
  });
  const counts = new Map(stages.map((row) => [row.label, Number(row.count)]));
  const pipeline = ["待询价", "待核价", "待审批", "已下单", "已到货"].map((label) => ({ label, count: counts.get(label) ?? 0 }));
  return { cashCurve, costCategories: categories.map((row) => ({ ...row, valueCents: Number(row.valueCents) })), pipeline };
}
