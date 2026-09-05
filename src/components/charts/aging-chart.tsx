"use client";

import Link from "next/link";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useRouter } from "next/navigation";
import type { BucketPoint } from "@/data/analytics/types";
import { ChartEmpty, DrilldownTooltip, useReducedMotion } from "./chart-shell";

const agingColors = ["var(--chart-sage)", "var(--chart-gold)", "var(--chart-payable)", "var(--chart-clay)", "var(--chart-risk)"];

function BucketChart({ data, ariaLabel, hrefBase, colors = agingColors }: { data: BucketPoint[]; ariaLabel: string; hrefBase: string; colors?: string[] }) {
  const reducedMotion = useReducedMotion();
  const router = useRouter();
  if (!data.some((item) => item.valueCents > 0)) return <ChartEmpty title="暂无未结清数据" />;
  return <div className="chart-frame" role="group" aria-label={ariaLabel}><div className="chart-stage compact"><ResponsiveContainer width="100%" height="100%"><BarChart data={data} margin={{ top: 8, right: 6, left: 0, bottom: 0 }} onClick={(state) => { const index = Number(state?.activeIndex); const item = Number.isInteger(index) ? data[index] : undefined; if (item) router.push(`${hrefBase}?bucket=${encodeURIComponent(item.label)}`); }} style={{ cursor: "pointer" }}>
    <CartesianGrid vertical={false} strokeDasharray="3 4" />
    <XAxis dataKey="label" axisLine={false} tickLine={false} interval={0} />
    <YAxis axisLine={false} tickLine={false} width={56} tickFormatter={(value) => `${Math.round(Number(value) / 1_000_000)}万`} />
    <Tooltip content={<DrilldownTooltip note="点击按该区间查看明细" />} />
    <Bar name="未结清金额" dataKey="valueCents" radius={[3, 3, 0, 0]} isAnimationActive={!reducedMotion} animationDuration={720}>{data.map((item, index) => <Cell className="chart-clickable" key={item.label} fill={colors[index % colors.length]} />)}</Bar>
  </BarChart></ResponsiveContainer></div><nav className="chart-drill-links" aria-label={`${ariaLabel}明细入口`}>{data.map((item) => <Link href={`${hrefBase}?bucket=${encodeURIComponent(item.label)}`} key={item.label}>{item.label}</Link>)}</nav></div>;
}
export function ReceivableAgingChart({ data }: { data: BucketPoint[] }) {
  return <BucketChart data={data} ariaLabel="应收账龄结构" hrefBase="/receivables" />;
}

export function PayableMaturityChart({ data }: { data: BucketPoint[] }) {
  return <BucketChart data={data} ariaLabel="应付到期结构" hrefBase="/payables" colors={["var(--chart-risk)", "var(--chart-payable)", "var(--chart-gold)", "var(--chart-budget)"]} />;
}
