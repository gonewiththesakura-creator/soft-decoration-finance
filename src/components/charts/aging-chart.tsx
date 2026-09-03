"use client";

import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { BucketPoint } from "@/data/analytics/types";
import { ChartEmpty, MoneyTooltip, useReducedMotion } from "./chart-shell";

const agingColors = ["var(--chart-sage)", "var(--chart-gold)", "var(--chart-payable)", "var(--chart-clay)", "var(--chart-risk)"];

function BucketChart({ data, ariaLabel, colors = agingColors }: { data: BucketPoint[]; ariaLabel: string; colors?: string[] }) {
  const reducedMotion = useReducedMotion();
  if (!data.some((item) => item.valueCents > 0)) return <ChartEmpty title="暂无未结清数据" />;
  return <div className="chart-frame" role="img" aria-label={ariaLabel}><div className="chart-stage compact"><ResponsiveContainer width="100%" height="100%"><BarChart data={data} margin={{ top: 8, right: 6, left: 0, bottom: 0 }}>
    <CartesianGrid vertical={false} strokeDasharray="3 4" />
    <XAxis dataKey="label" axisLine={false} tickLine={false} interval={0} />
    <YAxis axisLine={false} tickLine={false} width={56} tickFormatter={(value) => `${Math.round(Number(value) / 1_000_000)}万`} />
    <Tooltip content={<MoneyTooltip />} />
    <Bar name="未结清金额" dataKey="valueCents" radius={[3, 3, 0, 0]} isAnimationActive={!reducedMotion} animationDuration={640}>{data.map((item, index) => <Cell key={item.label} fill={colors[index % colors.length]} />)}</Bar>
  </BarChart></ResponsiveContainer></div></div>;
}
export function ReceivableAgingChart({ data }: { data: BucketPoint[] }) {
  return <BucketChart data={data} ariaLabel="应收账龄结构" />;
}

export function PayableMaturityChart({ data }: { data: BucketPoint[] }) {
  return <BucketChart data={data} ariaLabel="应付到期结构" colors={["var(--chart-risk)", "var(--chart-payable)", "var(--chart-gold)", "var(--chart-budget)"]} />;
}
