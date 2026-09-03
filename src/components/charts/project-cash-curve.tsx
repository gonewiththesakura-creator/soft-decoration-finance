"use client";

import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartEmpty, ChartLegend, MoneyTooltip, useReducedMotion } from "./chart-shell";

type Point = { label: string; receivedCents: number; paidCents: number };

export function ProjectCashCurve({ data }: { data: Point[] }) {
  const reducedMotion = useReducedMotion();
  if (!data.length) return <ChartEmpty title="暂无累计收支" detail="项目确认收款或付款后自动生成曲线。" />;
  return <div className="chart-frame" role="img" aria-label="项目累计收款与累计付款曲线">
    <div className="chart-stage"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={data} margin={{ top: 10, right: 8, left: 0, bottom: 0 }}>
      <CartesianGrid vertical={false} strokeDasharray="3 4" />
      <XAxis dataKey="label" axisLine={false} tickLine={false} />
      <YAxis axisLine={false} tickLine={false} width={58} tickFormatter={(value) => `${Math.round(Number(value) / 1_000_000)}万`} />
      <Tooltip content={<MoneyTooltip />} />
      <Area name="累计收款" type="monotone" dataKey="receivedCents" stroke="var(--chart-receivable)" fill="var(--chart-receivable)" fillOpacity={0.11} strokeWidth={2.2} isAnimationActive={!reducedMotion} animationDuration={640} />
      <Line name="累计付款" type="monotone" dataKey="paidCents" stroke="var(--chart-payable)" strokeWidth={2.2} dot={false} activeDot={{ r: 4 }} isAnimationActive={!reducedMotion} animationDuration={640} />
    </ComposedChart></ResponsiveContainer></div>
    <ChartLegend items={[{ label: "累计收款", color: "var(--chart-receivable)" }, { label: "累计付款", color: "var(--chart-payable)" }]} />
  </div>;
}
