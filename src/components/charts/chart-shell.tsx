"use client";

import { useEffect, useState } from "react";
import { ChartNoAxesCombined } from "lucide-react";
import { formatMoney } from "@/lib/format";

export type ChartLegendItem = { label: string; color: string };
export type ChartTooltipEntry = { name?: string; value?: number | string; color?: string; dataKey?: string | number };

export function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return reduced;
}
export function ChartEmpty({ title = "暂无可视化数据", detail = "完成相关业务记录后，这里会自动生成趋势。" }: { title?: string; detail?: string }) {
  return <div className="chart-empty"><ChartNoAxesCombined aria-hidden="true" /><strong>{title}</strong><span>{detail}</span></div>;
}

export function ChartLegend({ items }: { items: ChartLegendItem[] }) {
  return <div className="chart-legend" aria-label="图表图例">{items.map((item) => <span key={item.label}><i className="chart-dot" style={{ backgroundColor: item.color }} />{item.label}</span>)}</div>;
}

export function MoneyTooltip({ active, payload, label }: { active?: boolean; payload?: readonly ChartTooltipEntry[]; label?: string | number }) {
  if (!active || !payload?.length) return null;
  return <div className="chart-tooltip"><div className="chart-tooltip-title">{label}</div>{payload.map((entry) => <div className="chart-tooltip-row" key={String(entry.dataKey ?? entry.name)}><span><i className="chart-dot" style={{ display: "inline-block", marginRight: 6, backgroundColor: entry.color }} />{entry.name}</span><strong>{formatMoney(Number(entry.value), true)}</strong></div>)}</div>;
}

export function PercentageTooltip({ active, payload, label }: { active?: boolean; payload?: readonly ChartTooltipEntry[]; label?: string | number }) {
  if (!active || !payload?.length) return null;
  return <div className="chart-tooltip"><div className="chart-tooltip-title">{label}</div>{payload.map((entry) => <div className="chart-tooltip-row" key={String(entry.dataKey ?? entry.name)}><span><i className="chart-dot" style={{ display: "inline-block", marginRight: 6, backgroundColor: entry.color }} />{entry.name}</span><strong>{Number(entry.value)}%</strong></div>)}</div>;
}
