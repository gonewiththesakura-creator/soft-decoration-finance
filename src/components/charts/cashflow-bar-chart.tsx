"use client";

import Link from "next/link";
import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useRouter } from "next/navigation";
import { ChartEmpty, ChartLegend, DrilldownTooltip, useReducedMotion } from "./chart-shell";

type Week = { label: string; receivableCents: number; payableCents: number };

export function CashflowBarChart({ data }: { data: Week[] }) {
  const reducedMotion = useReducedMotion();
  const router = useRouter();
  const [activeBar, setActiveBar] = useState<string | null>(null);
  if (!data.length) return <ChartEmpty />;
  const cellClass = (key: string) => `chart-clickable chart-interactive-bar ${activeBar === key ? "is-active" : activeBar ? "is-muted" : ""}`;
  return <div className="chart-frame" role="group" aria-label="未来三十天应收与应付分周对比">
    <div className="chart-stage compact" onMouseLeave={() => setActiveBar(null)}><ResponsiveContainer width="100%" height="100%"><BarChart data={data} margin={{ top: 12, right: 8, left: 0, bottom: 0 }} barGap={4} onClick={() => router.push("/finance-workspace#execution")} style={{ cursor: "pointer" }}>
      <CartesianGrid vertical={false} strokeDasharray="3 4" />
      <XAxis dataKey="label" axisLine={false} tickLine={false} />
      <YAxis axisLine={false} tickLine={false} width={60} tickFormatter={(value) => `${Math.round(Number(value) / 1_000_000)}万`} />
      <Tooltip content={<DrilldownTooltip note="点击进入财务执行区" />} />
      <Bar name="预计收款" dataKey="receivableCents" fill="var(--chart-receivable)" radius={[3, 3, 0, 0]} isAnimationActive={!reducedMotion} animationDuration={640}>{data.map((item, index) => { const key = `receivable-${index}`; return <Cell key={`${item.label}-receivable`} className={cellClass(key)} onMouseEnter={() => setActiveBar(key)} />; })}</Bar>
      <Bar name="预计付款" dataKey="payableCents" fill="var(--chart-payable)" radius={[3, 3, 0, 0]} isAnimationActive={!reducedMotion} animationDuration={640}>{data.map((item, index) => { const key = `payable-${index}`; return <Cell key={`${item.label}-payable`} className={cellClass(key)} onMouseEnter={() => setActiveBar(key)} />; })}</Bar>
    </BarChart></ResponsiveContainer></div>
    <ChartLegend items={[{ label: "预计收款", color: "var(--chart-receivable)" }, { label: "预计付款", color: "var(--chart-payable)" }]} />
    <Link className="chart-drill-link" href="/finance-workspace#execution">进入财务执行区</Link>
  </div>;
}
