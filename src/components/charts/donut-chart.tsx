"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { setCompanyScope } from "@/app/(app)/actions";
import { formatMoney } from "@/lib/format";
import { ChartEmpty, DrilldownTooltip, useReducedMotion } from "./chart-shell";

export type DonutPoint = { id?: number; label: string; valueCents: number };
const colors = ["var(--chart-balance)", "var(--chart-payable)", "var(--chart-clay)", "var(--chart-sage)", "var(--chart-gold)", "var(--chart-risk)", "var(--chart-budget)"];

function MoneyDonut({ data, ariaLabel, interactive = false }: { data: DonutPoint[]; ariaLabel: string; interactive?: boolean }) {
  const reducedMotion = useReducedMotion();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [active, setActive] = useState<string | null>(null);
  const colorByLabel = new Map(data.map((item, index) => [item.label, colors[index % colors.length]]));
  const pieData = data.filter((item) => item.valueCents > 0);
  const total = data.reduce((sum, item) => sum + item.valueCents, 0);
  const positiveTotal = pieData.reduce((sum, item) => sum + item.valueCents, 0);
  const activeItem = active === null ? null : data.find((item) => item.label === active) ?? null;
  if (!data.length) return <ChartEmpty title="暂无结构数据" />;
  const select = (item: DonutPoint) => {
    if (!interactive || !item.id) return;
    startTransition(async () => { await setCompanyScope(String(item.id)); router.refresh(); });
  };
  return <div className="chart-frame interactive-donut" role="group" aria-label={ariaLabel} aria-busy={isPending}>
    <div className="donut-stage chart-stage compact">
      {pieData.length ? <ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={pieData} dataKey="valueCents" nameKey="label" innerRadius="56%" outerRadius={(item) => active === item.label ? "86%" : "82%"} paddingAngle={2} stroke="var(--surface)" strokeWidth={2} isAnimationActive={!reducedMotion} animationDuration={760} animationEasing="ease-out" onMouseEnter={(_, index) => setActive(pieData[index]?.label ?? null)} onMouseLeave={() => setActive(null)}>{pieData.map((item) => <Cell className={`${interactive ? "chart-clickable " : ""}donut-sector ${active === item.label ? "is-active" : active ? "is-muted" : ""}`} key={item.label} fill={colorByLabel.get(item.label)} opacity={active === null || active === item.label ? 1 : .44} onClick={() => select(item)} />)}</Pie><Tooltip content={<DrilldownTooltip note={interactive ? "点击切换公司范围" : undefined} />} /></PieChart></ResponsiveContainer> : <ChartEmpty title="当前没有正向余额" detail="零值或负余额仍在下方明细中保留。" />}
      <div className="donut-center"><span>{activeItem?.label ?? (interactive ? "集团净资金" : "合计")}</span><strong className={Number(activeItem?.valueCents ?? total) < 0 ? "danger-text" : ""}>{formatMoney(activeItem?.valueCents ?? total, true)}</strong><small>{activeItem && activeItem.valueCents > 0 && positiveTotal > 0 ? `${Math.round(activeItem.valueCents / positiveTotal * 1000) / 10}%` : "资金结构"}</small></div>
    </div>
    <div className="chart-legend interactive-legend" aria-label="图表图例">{data.map((item) => <button type="button" className={`${item.valueCents < 0 ? "negative " : ""}${active === item.label ? "is-active" : active ? "is-muted" : ""}`} key={item.label} disabled={isPending} onMouseEnter={() => setActive(item.label)} onMouseLeave={() => setActive(null)} onFocus={() => setActive(item.label)} onBlur={() => setActive(null)} onClick={() => interactive ? select(item) : setActive((current) => current === item.label ? null : item.label)}><i className="chart-dot" style={{ backgroundColor: item.valueCents < 0 ? "var(--chart-risk)" : colorByLabel.get(item.label) }} /><span>{item.label}</span><small>{formatMoney(item.valueCents, true)}</small></button>)}</div>
  </div>;
}

export function CompanyFundsDonut({ data, interactive = true }: { data: DonutPoint[]; interactive?: boolean }) {
  return <MoneyDonut data={data} ariaLabel="公司资金余额分布" interactive={interactive} />;
}

export function CostCategoryDonut({ data }: { data: DonutPoint[] }) {
  return <MoneyDonut data={data} ariaLabel="项目采购成本品类结构" />;
}
