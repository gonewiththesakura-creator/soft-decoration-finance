"use client";

import Link from "next/link";
import { AlertTriangle, ArrowUpRight, CheckSquare2, FileWarning, FolderKanban, Landmark, ReceiptText } from "lucide-react";
import { MetricCountUp } from "@/components/charts/metric-count-up";
import { ExecutiveHoverDetail } from "@/components/executive/executive-hover-detail";
import { KpiMiniBars } from "@/components/executive/kpi-mini-bars";

const icons = { balance: Landmark, receivable: ReceiptText, approvals: CheckSquare2, projects: FolderKanban, invoices: FileWarning, risk: AlertTriangle };
type IconName = keyof typeof icons;

export function ExecutiveMetricCard({ label, valueCents, count, accessible = true, detail, insight, href, icon, tone = "neutral", primary = false, trend = [], detailTitle = "经营细分" }: { label: string; valueCents?: number | null; count?: number | null; accessible?: boolean; detail: string; insight: string[]; href?: string; icon: IconName; tone?: "neutral" | "success" | "warning" | "danger"; primary?: boolean; trend?: number[]; detailTitle?: string }) {
  const Icon = icons[icon];
  const detailId = `executive-metric-detail-${label.replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, "-")}`;
  const content = <>
    <span className="executive-metric-glow" aria-hidden="true" />
    <div className="executive-metric-top"><span>{label}</span><Icon aria-hidden="true" /></div>
    <div className="executive-metric-value">{!accessible ? "无权限" : valueCents !== undefined && valueCents !== null ? <MetricCountUp valueCents={valueCents} /> : `${count ?? 0}`}</div>
    <div className="executive-metric-foot"><small>{accessible ? detail : "该字段未纳入当前账号分析"}</small>{trend.length ? <KpiMiniBars values={trend} /> : <ArrowUpRight aria-hidden="true" />}</div>
    <ExecutiveHoverDetail id={detailId} title={detailTitle} items={accessible ? insight : ["该字段未纳入当前账号分析"]} />
  </>;
  const className = `executive-metric ${tone} ${primary ? "primary" : ""} ${href ? "" : "disabled"}`;
  return href ? <Link className={className} href={href} aria-label={`${label}，查看明细`} aria-describedby={detailId}>{content}</Link> : <div className={className} tabIndex={accessible ? 0 : undefined} aria-label={`${label}，当前账号无可用明细入口`} aria-describedby={detailId}>{content}</div>;
}
