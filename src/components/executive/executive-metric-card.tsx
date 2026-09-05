"use client";

import Link from "next/link";
import { AlertTriangle, ArrowUpRight, CheckSquare2, FileWarning, FolderKanban, Landmark, ReceiptText } from "lucide-react";
import { MetricCountUp } from "@/components/charts/metric-count-up";

const icons = { balance: Landmark, receivable: ReceiptText, approvals: CheckSquare2, projects: FolderKanban, invoices: FileWarning, risk: AlertTriangle };
type IconName = keyof typeof icons;

function MiniTrend({ values }: { values: number[] }) {
  const max = Math.max(...values.map((value) => Math.abs(value)), 1);
  return <span className="kpi-mini-trend" aria-hidden="true">{values.map((value, index) => <i key={index} style={{ height: `${Math.max(18, Math.abs(value) / max * 100)}%` }} />)}</span>;
}

export function ExecutiveMetricCard({ label, valueCents, count, accessible = true, detail, insight, href, icon, tone = "neutral", primary = false, trend = [] }: { label: string; valueCents?: number | null; count?: number | null; accessible?: boolean; detail: string; insight: string[]; href?: string; icon: IconName; tone?: "neutral" | "success" | "warning" | "danger"; primary?: boolean; trend?: number[] }) {
  const Icon = icons[icon];
  const content = <>
    <div className="executive-metric-top"><span>{label}</span><Icon aria-hidden="true" /></div>
    <div className="executive-metric-value">{!accessible ? "无权限" : valueCents !== undefined && valueCents !== null ? <MetricCountUp valueCents={valueCents} /> : `${count ?? 0}`}</div>
    <div className="executive-metric-foot"><small>{accessible ? detail : "该字段未纳入当前账号分析"}</small>{trend.length ? <MiniTrend values={trend} /> : <ArrowUpRight aria-hidden="true" />}</div>
    <div className="executive-metric-insight" role="note"><strong>经营解释</strong>{insight.slice(0, 3).map((item) => <span key={item}>{item}</span>)}</div>
  </>;
  const className = `executive-metric ${tone} ${primary ? "primary" : ""} ${href ? "" : "disabled"}`;
  return href ? <Link className={className} href={href} aria-label={`${label}，查看明细`}>{content}</Link> : <div className={className} aria-label={`${label}，当前账号无可用明细入口`}>{content}</div>;
}
