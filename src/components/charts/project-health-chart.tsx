"use client";

import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartEmpty, ChartLegend, PercentageTooltip, useReducedMotion } from "./chart-shell";

type ProjectHealth = { name: string; score: number; budgetRate: number; collectionRate: number; tone: "healthy" | "watch" | "risk" };
const toneColor = { healthy: "var(--chart-receivable)", watch: "var(--chart-payable)", risk: "var(--chart-risk)" };

export function ProjectHealthChart({ data }: { data: ProjectHealth[] }) {
  const reducedMotion = useReducedMotion();
  if (!data.length) return <ChartEmpty title="暂无项目健康数据" detail="当前数据范围内没有进行中的项目。" />;
  return <div className="chart-frame" role="img" aria-label="项目健康、预算占用与回款率排行榜">
    <div className="chart-stage tall"><ResponsiveContainer width="100%" height="100%"><BarChart data={data} layout="vertical" margin={{ top: 6, right: 12, left: 4, bottom: 0 }} barGap={2}>
      <CartesianGrid horizontal={false} strokeDasharray="3 4" />
      <XAxis type="number" domain={[0, (max: number) => Math.max(100, Math.ceil(max / 20) * 20)]} axisLine={false} tickLine={false} tickFormatter={(value) => `${value}%`} />
      <YAxis type="category" dataKey="name" width={118} axisLine={false} tickLine={false} tick={{ fontSize: 10 }} />
      <Tooltip content={<PercentageTooltip />} />
      <Bar name="健康分" dataKey="score" radius={[0, 3, 3, 0]} isAnimationActive={!reducedMotion} animationDuration={640}>{data.map((item) => <Cell key={item.name} fill={toneColor[item.tone]} />)}</Bar>
      <Bar name="预算占用" dataKey="budgetRate" fill="var(--chart-budget)" radius={[0, 3, 3, 0]} isAnimationActive={!reducedMotion} animationDuration={640} />
      <Bar name="回款率" dataKey="collectionRate" fill="var(--chart-sage)" radius={[0, 3, 3, 0]} isAnimationActive={!reducedMotion} animationDuration={640} />
    </BarChart></ResponsiveContainer></div>
    <ChartLegend items={[{ label: "健康分（颜色表示风险）", color: "var(--chart-receivable)" }, { label: "预算占用", color: "var(--chart-budget)" }, { label: "回款率", color: "var(--chart-sage)" }]} />
  </div>;
}
