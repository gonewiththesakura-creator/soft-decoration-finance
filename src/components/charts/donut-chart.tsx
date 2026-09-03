"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { formatMoney } from "@/lib/format";
import { ChartEmpty, ChartLegend, MoneyTooltip, useReducedMotion } from "./chart-shell";

export type DonutPoint = { label: string; valueCents: number };
const colors = ["var(--chart-balance)", "var(--chart-payable)", "var(--chart-clay)", "var(--chart-sage)", "var(--chart-gold)", "var(--chart-risk)", "var(--chart-budget)"];

function MoneyDonut({ data, ariaLabel }: { data: DonutPoint[]; ariaLabel: string }) {
  const reducedMotion = useReducedMotion();
  const populated = data.filter((item) => item.valueCents > 0);
  const total = populated.reduce((sum, item) => sum + item.valueCents, 0);
  if (!populated.length) return <ChartEmpty title="暂无结构数据" />;
  return <div className="chart-frame" role="img" aria-label={ariaLabel}>
    <div className="donut-stage chart-stage compact">
      <ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={populated} dataKey="valueCents" nameKey="label" innerRadius="56%" outerRadius="82%" paddingAngle={2} stroke="var(--surface)" strokeWidth={2} isAnimationActive={!reducedMotion} animationDuration={640}>{populated.map((item, index) => <Cell key={item.label} fill={colors[index % colors.length]} />)}</Pie><Tooltip content={<MoneyTooltip />} /></PieChart></ResponsiveContainer>
      <div className="donut-center"><span>合计</span><strong>{formatMoney(total, true)}</strong></div>
    </div>
    <ChartLegend items={populated.map((item, index) => ({ label: item.label, color: colors[index % colors.length] }))} />
  </div>;
}
export function CompanyFundsDonut({ data }: { data: DonutPoint[] }) {
  return <MoneyDonut data={data} ariaLabel="公司资金余额分布" />;
}

export function CostCategoryDonut({ data }: { data: DonutPoint[] }) {
  return <MoneyDonut data={data} ariaLabel="项目采购成本品类结构" />;
}
