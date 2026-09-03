"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartEmpty, ChartLegend, MoneyTooltip, useReducedMotion } from "./chart-shell";

type Week = { label: string; receivableCents: number; payableCents: number };

export function CashflowBarChart({ data }: { data: Week[] }) {
  const reducedMotion = useReducedMotion();
  if (!data.length) return <ChartEmpty />;
  return <div className="chart-frame" role="img" aria-label="未来三十天应收与应付分周对比">
    <div className="chart-stage compact"><ResponsiveContainer width="100%" height="100%"><BarChart data={data} margin={{ top: 12, right: 8, left: 0, bottom: 0 }} barGap={4}>
      <CartesianGrid vertical={false} strokeDasharray="3 4" />
      <XAxis dataKey="label" axisLine={false} tickLine={false} />
      <YAxis axisLine={false} tickLine={false} width={60} tickFormatter={(value) => `${Math.round(Number(value) / 1_000_000)}万`} />
      <Tooltip content={<MoneyTooltip />} />
      <Bar name="预计收款" dataKey="receivableCents" fill="var(--chart-receivable)" radius={[3, 3, 0, 0]} isAnimationActive={!reducedMotion} animationDuration={640} />
      <Bar name="预计付款" dataKey="payableCents" fill="var(--chart-payable)" radius={[3, 3, 0, 0]} isAnimationActive={!reducedMotion} animationDuration={640} />
    </BarChart></ResponsiveContainer></div>
    <ChartLegend items={[{ label: "预计收款", color: "var(--chart-receivable)" }, { label: "预计付款", color: "var(--chart-payable)" }]} />
  </div>;
}
