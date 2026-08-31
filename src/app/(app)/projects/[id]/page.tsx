import Link from "next/link";
import { notFound } from "next/navigation";
import { Building2, CalendarDays, UserRound } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { formatDate, formatMoney, getStatusTone } from "@/lib/format";
import { getProjectDetail, getProjectTab, projectTabs, type ProjectTab } from "@/data/project-detail";
import { SimpleTable } from "@/components/simple-table";

export default async function ProjectDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const [{ id }, query, user] = await Promise.all([params, searchParams, requireSession()]); const projectId = Number(id); const data = await getProjectDetail(projectId, user); if (!data) notFound();
  const tab = projectTabs.some(([key]) => key === query.tab) ? query.tab as ProjectTab : "overview"; const { project, metrics } = data;
  const metricItems = [
    ["经营确认收入", project.currentContractCents], ["已收款", metrics.receivedCents], ["未收款", metrics.receivableCents], ["已下单成本", metrics.orderedCents],
    ["已到货成本", metrics.deliveredCents], ["已付款成本", metrics.paidCents], ["已开票成本", metrics.purchaseInvoicedCents], ["客户已开票", metrics.salesInvoicedCents],
    ["供应商欠票", metrics.missingInvoiceCents], ["未来 30 天应收", metrics.futureReceivableCents], ["未来 30 天应付", metrics.futurePayableCents],
  ] as const;
  const tabData = tab === "overview" ? null : await getProjectTab(projectId, tab);
  const costRate = project.budgetCents ? Math.min(100, Math.round(metrics.orderedCents / project.budgetCents * 100)) : 0;
  const receiptRate = project.currentContractCents ? Math.min(100, Math.round(metrics.receivedCents / project.currentContractCents * 100)) : 0;
  return <main className="content">
    <div className="project-titlebar"><div className="project-title-row"><div><div className="project-code">{project.code}</div><div className="project-name">{project.name}</div><div className="project-meta"><span><Building2 size={13} /> {project.companyName}</span><span><UserRound size={13} /> {project.customerName} · {project.managerName}</span><span><CalendarDays size={13} /> {formatDate(project.startDate)} 至 {formatDate(project.expectedEndDate)}</span></div></div><span className={`badge ${getStatusTone(project.status)}`}>{project.status}</span></div></div>
    <section className="metric-grid" style={{ gridTemplateColumns: "repeat(6,minmax(0,1fr))" }}>{metricItems.slice(0, 6).map(([label, value]) => <div className="metric" key={label}><div className="metric-label">{label}</div><div className="metric-value" style={{ fontSize: 17 }}>{formatMoney(value, true)}</div></div>)}</section>
    <section className="panel"><nav className="tabs">{projectTabs.map(([key, label]) => <Link key={key} href={`/projects/${projectId}?tab=${key}`} className={`tab ${tab === key ? "active" : ""}`}>{label}</Link>)}</nav>
      {tabData ? <SimpleTable columns={tabData.columns} rows={tabData.rows} /> : <div className="detail-layout" style={{ padding: 16, marginTop: 0 }}><div>
        <div className="panel" style={{ marginBottom: 16 }}><div className="panel-header"><div><div className="panel-title">经营进度</div><div className="panel-subtitle">合同回款与采购预算占用</div></div></div><div className="detail-section"><div className="progress-row"><div className="progress-head"><span>客户回款进度</span><span>{receiptRate}% · {formatMoney(metrics.receivedCents)}</span></div><div className="progress-track"><div className="progress-bar" style={{ width: `${receiptRate}%` }} /></div></div><div className="progress-row"><div className="progress-head"><span>采购预算占用</span><span>{costRate}% · {formatMoney(metrics.orderedCents)} / {formatMoney(project.budgetCents)}</span></div><div className="progress-track"><div className="progress-bar" style={{ width: `${costRate}%`, background: costRate >= 100 ? "var(--red)" : "var(--orange)" }} /></div></div></div></div>
        <div className="panel"><div className="panel-header"><div><div className="panel-title">应收节点</div><div className="panel-subtitle">质保金到期前独立呈现</div></div></div><SimpleTable columns={[{ key: "nodeName", label: "节点" }, { key: "amountCents", label: "应收", format: "money", align: "right" }, { key: "receivedCents", label: "已收", format: "money", align: "right" }, { key: "dueDate", label: "预计日期", format: "date" }, { key: "status", label: "状态", format: "status" }]} rows={data.receivables} /></div>
      </div><aside><div className="panel" style={{ marginBottom: 16 }}><div className="panel-header"><div className="panel-title">项目资料</div></div><div className="detail-section"><div className="balance-row"><div className="balance-name">原合同金额</div><div className="balance-amount">{formatMoney(project.originalContractCents, true)}</div></div><div className="balance-row"><div className="balance-name">审计状态</div><span className={`badge ${getStatusTone(project.auditStatus)}`}>{project.auditStatus}</span></div><div className="balance-row"><div className="balance-name">质保到期</div><div>{formatDate(project.warrantyEndDate)}</div></div><div className="balance-row"><div className="balance-name">设计师</div><div>{project.designerName}</div></div></div></div><div className="panel"><div className="panel-header"><div><div className="panel-title">最近动态</div><div className="panel-subtitle">关键操作审计</div></div></div><div className="detail-section">{data.logs.map((log) => <div className="timeline-item" key={log.id}><div>{log.userName} · {log.action} {log.objectType}</div><div className="timeline-time">{formatDate(log.createdAt)}</div></div>)}</div></div></aside></div>}
    </section>
  </main>;
}
