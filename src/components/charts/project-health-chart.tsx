"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatMoney } from "@/lib/format";
import { ChartEmpty, ChartLegend, useReducedMotion } from "./chart-shell";

type ProjectHealth = { id: number; name: string; score: number; budgetRate: number; procurementRate: number; collectionRate?: number; riskCount: number; reasons: string[]; budgetCents: number; orderedCents: number; overBudgetCents: number; contractCents?: number; receivedCents?: number; paidCents?: number; tone: "healthy" | "watch" | "risk" };
const toneColor = { healthy: "var(--chart-receivable)", watch: "var(--chart-payable)", risk: "var(--chart-risk)" };

function ProjectTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: ProjectHealth }> }) {
  const project = payload?.[0]?.payload;
  if (!active || !project) return null;
  return <div className="chart-tooltip project-health-tooltip"><div className="chart-tooltip-title">{project.name}</div><div className="chart-tooltip-row"><span>健康分</span><strong>{project.score}</strong></div><div className="chart-tooltip-row"><span>预算占用</span><strong>{project.budgetRate}%</strong></div>{project.collectionRate !== undefined ? <div className="chart-tooltip-row"><span>回款率</span><strong>{project.collectionRate}%</strong></div> : null}<div className="chart-tooltip-row"><span>采购执行</span><strong>{project.procurementRate}%</strong></div><div className="chart-tooltip-row"><span>风险项</span><strong>{project.riskCount}</strong></div><div className="chart-tooltip-row"><span>已下单</span><strong>{formatMoney(project.orderedCents, true)}</strong></div>{project.reasons.length ? <div className="chart-tooltip-note">{project.reasons.join(" · ")}</div> : <div className="chart-tooltip-note">当前未识别到突出风险</div>}</div>;
}

export function ProjectHealthChart({ data }: { data: ProjectHealth[] }) {
  const reducedMotion = useReducedMotion();
  const router = useRouter();
  if (!data.length) return <ChartEmpty title="暂无项目健康数据" detail="当前数据范围内没有进行中的项目。" />;
  return <div className="chart-frame" role="group" aria-label="项目健康分排行榜，点击进入项目">
    <div className="chart-stage tall"><ResponsiveContainer width="100%" height="100%"><BarChart data={data} layout="vertical" margin={{ top: 6, right: 34, left: 4, bottom: 0 }} onClick={(state) => { const index = Number(state?.activeIndex); const project = Number.isInteger(index) ? data[index] : undefined; if (project?.id) router.push(`/projects/${project.id}`); }} style={{ cursor: "pointer" }}>
      <CartesianGrid horizontal={false} strokeDasharray="3 4" />
      <XAxis type="number" domain={[0, 100]} axisLine={false} tickLine={false} tickFormatter={(value) => `${value}`} />
      <YAxis type="category" dataKey="name" width={118} axisLine={false} tickLine={false} tick={{ fontSize: 10 }} />
      <Tooltip content={<ProjectTooltip />} cursor={{ fill: "rgba(23, 60, 51, .045)" }} />
      <Bar name="健康分" dataKey="score" radius={[0, 4, 4, 0]} isAnimationActive={!reducedMotion} animationDuration={780}>{data.map((item) => <Cell key={item.id} fill={toneColor[item.tone]} />)}<LabelList dataKey="score" position="right" className="health-score-label" /></Bar>
    </BarChart></ResponsiveContainer></div>
    <ChartLegend items={[{ label: "稳健 80-100", color: "var(--chart-receivable)" }, { label: "关注 60-79", color: "var(--chart-payable)" }, { label: "风险 0-59", color: "var(--chart-risk)" }]} />
    <nav className="chart-drill-links project-drill-links" aria-label="项目健康明细入口">{data.map((project) => <Link key={project.id} href={`/projects/${project.id}`}>{project.name} · {project.score}</Link>)}</nav>
  </div>;
}
