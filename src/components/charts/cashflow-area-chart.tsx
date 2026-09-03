"use client";

import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { CashflowPoint } from "@/data/analytics/types";
import { ChartEmpty, ChartLegend, MoneyTooltip, useReducedMotion } from "./chart-shell";

const legend = [
  { label: "预计余额", color: "var(--chart-balance)" },
  { label: "预计收款", color: "var(--chart-receivable)" },
  { label: "预计付款", color: "var(--chart-payable)" },
];

export function CashflowAreaChart({ data, ariaLabel = "未来三十天现金流趋势" }: { data: CashflowPoint[]; ariaLabel?: string }) {
  const reducedMotion = useReducedMotion();
  if (!data.length) return <ChartEmpty title="暂无现金流预测" detail="录入应收与应付到期计划后自动生成。" />;
  return <div className="chart-frame" role="img" aria-label={ariaLabel}>
    <div className="chart-stage tall">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 12, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} strokeDasharray="3 4" />
          <XAxis dataKey="label" axisLine={false} tickLine={false} interval={4} />
          <YAxis axisLine={false} tickLine={false} width={60} tickFormatter={(value) => `${Math.round(Number(value) / 1_000_000)}万`} />
          <Tooltip content={<MoneyTooltip />} />
          <ReferenceLine y={0} stroke="var(--chart-risk)" strokeDasharray="4 4" />
          <Area name="预计余额" type="monotone" dataKey="balanceCents" stroke="var(--chart-balance)" fill="var(--chart-balance)" fillOpacity={0.12} strokeWidth={2.5} isAnimationActive={!reducedMotion} animationDuration={640} />
          <Line name="预计收款" type="monotone" dataKey="receivableCents" stroke="var(--chart-receivable)" strokeWidth={1.8} dot={false} activeDot={{ r: 4 }} isAnimationActive={!reducedMotion} animationDuration={640} />
          <Line name="预计付款" type="monotone" dataKey="payableCents" stroke="var(--chart-payable)" strokeWidth={1.8} dot={false} activeDot={{ r: 4 }} isAnimationActive={!reducedMotion} animationDuration={640} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
    <ChartLegend items={legend} />
  </div>;
}
