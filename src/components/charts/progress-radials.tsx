"use client";

import { Cell, PolarAngleAxis, RadialBar, RadialBarChart, ResponsiveContainer, Tooltip } from "recharts";
import { ChartEmpty, PercentageTooltip, useReducedMotion } from "./chart-shell";

export type ProgressPoint = { label: string; value: number; detail: string };
const colors = ["var(--chart-receivable)", "var(--chart-budget)", "var(--chart-sage)", "var(--chart-payable)", "var(--chart-clay)"];

export function ProgressRadials({ data }: { data: ProgressPoint[] }) {
  const reducedMotion = useReducedMotion();
  if (!data.length) return <ChartEmpty />;
  return <div className="progress-radial-layout" role="img" aria-label="项目回款、采购、到货、付款与发票进度">
    <div className="chart-stage radial"><ResponsiveContainer width="100%" height="100%"><RadialBarChart data={data} innerRadius="24%" outerRadius="92%" startAngle={90} endAngle={-270} barSize={10}>
      <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
      <RadialBar name="完成度" dataKey="value" background={{ fill: "var(--canvas-deep)" }} cornerRadius={5} isAnimationActive={!reducedMotion} animationDuration={640}>{data.map((item, index) => <Cell key={item.label} fill={colors[index % colors.length]} />)}</RadialBar>
      <Tooltip content={<PercentageTooltip />} />
    </RadialBarChart></ResponsiveContainer></div>
    <div className="progress-radial-legend">{data.map((item, index) => <div key={item.label}><i className="chart-dot" style={{ backgroundColor: colors[index % colors.length] }} /><span>{item.label}<small>{item.detail}</small></span><strong>{item.value}%</strong></div>)}</div>
  </div>;
}
