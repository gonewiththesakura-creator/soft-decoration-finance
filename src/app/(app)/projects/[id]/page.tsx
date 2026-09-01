import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, Building2, CalendarDays, MapPin, UserRound } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { formatDate, formatMoney, getStatusTone } from "@/lib/format";
import { getProjectDetail, getProjectSections, projectTabs, type ProjectTab } from "@/data/project-detail";
import { SimpleTable } from "@/components/simple-table";
import { AttachmentPanel } from "@/components/attachment-panel";

function Rate({ label, value, total, tone = "green" }: { label: string; value: number; total: number; tone?: "green" | "orange" | "red" }) {
  const rate = total > 0 ? Math.round(value / total * 100) : 0; const width = Math.min(100, Math.max(0, rate));
  return <div className="progress-row"><div className="progress-head"><span>{label}</span><span>{rate}% · {formatMoney(value, true)} / {formatMoney(total, true)}</span></div><div className="progress-track"><div className={`progress-bar ${tone}`} style={{ width: `${width}%` }} /></div></div>;
}

function LedgerGroup({ title, items }: { title: string; items: [string, number, string?][] }) {
  return <section className="ledger-group"><div className="ledger-group-title">{title}</div>{items.map(([label, value, tone]) => <div className="ledger-line" key={label}><span>{label}</span><strong className={tone ?? ""}>{formatMoney(value, true)}</strong></div>)}</section>;
}

export default async function ProjectDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const [{ id }, query, user] = await Promise.all([params, searchParams, requireSession()]); const projectId = Number(id); const data = await getProjectDetail(projectId, user); if (!data) notFound();
  const tab = projectTabs.some(([key]) => key === query.tab) ? query.tab as ProjectTab : "overview"; const { project, metrics } = data;
  const sections = tab !== "overview" && tab !== "attachments" ? await getProjectSections(projectId, tab) : [];
  return <main className="content project-ledger">
    <div className="project-titlebar"><div className="project-title-row"><div><div className="project-code">{project.code}</div><div className="project-name">{project.name}</div><div className="project-meta"><span><Building2 />{project.companyName}</span><Link href={`/customers/${project.customerId}`}><UserRound />{project.customerName}</Link><span><UserRound />项目经理 {project.managerName}</span><span><UserRound />设计师 {project.designerName}</span><span><CalendarDays />{formatDate(project.startDate)} 至 {formatDate(project.expectedEndDate)}</span><span><MapPin />{project.address || "未填写地址"}</span></div></div><span className={`badge ${getStatusTone(project.status)}`}>{project.status}</span></div></div>
    <nav className="tabs project-tabs">{projectTabs.map(([key, label]) => <Link key={key} href={`/projects/${projectId}?tab=${key}`} className={`tab ${tab === key ? "active" : ""}`}>{label}</Link>)}</nav>
    {tab === "overview" ? <>
      <div className="ledger-groups">
        <LedgerGroup title="收入" items={[["原始合同金额", project.originalContractCents], ["当前合同金额", project.currentContractCents], ["经营确认收入", project.currentContractCents], ["已收款", metrics.receivedCents, "success-text"], ["未收款", metrics.receivableCents], ["逾期应收", metrics.overdueReceivableCents, metrics.overdueReceivableCents ? "danger-text" : ""], ["未来 30 天应收", metrics.futureReceivableCents]]} />
        <LedgerGroup title="采购" items={[["项目采购预算", project.budgetCents], ["已申请采购", metrics.appliedCents], ["已下单成本", metrics.orderedCents], ["已到货成本", metrics.deliveredCents], ["已付款成本", metrics.paidCents], ["已开票成本", metrics.purchaseInvoicedCents], ["剩余采购预算", Math.max(0, metrics.remainingBudgetCents)], ["超预算金额", Math.max(0, -metrics.remainingBudgetCents), metrics.remainingBudgetCents < 0 ? "danger-text" : ""]]} />
        <LedgerGroup title="财务" items={[["已开销项发票", metrics.salesInvoicedCents], ["未开销项发票", Math.max(0, project.currentContractCents - metrics.salesInvoicedCents)], ["已收进项发票", metrics.purchaseInvoicedCents], ["供应商欠票", metrics.missingInvoiceCents, metrics.missingInvoiceCents ? "warning-text" : ""], ["未来 30 天应付", metrics.futurePayableCents], ["项目收支净额", metrics.projectCashCents], ["当前项目资金缺口", metrics.currentFundingGapCents, metrics.currentFundingGapCents ? "danger-text" : ""]]} />
      </div>
      <div className="project-overview-grid"><section className="panel"><div className="panel-header"><div><div className="panel-title">经营进度</div><div className="panel-subtitle">按当前有效业务金额计算</div></div></div><div className="detail-section progress-stack"><Rate label="回款进度" value={metrics.receivedCents} total={project.currentContractCents} /><Rate label="采购预算占用" value={metrics.orderedCents} total={project.budgetCents} tone={metrics.orderedCents > project.budgetCents ? "red" : "orange"} /><Rate label="付款进度" value={metrics.paidCents} total={metrics.orderedCents} /><Rate label="到货进度" value={metrics.deliveredCents} total={metrics.orderedCents} /><Rate label="进项发票覆盖率" value={metrics.purchaseInvoicedCents} total={metrics.payableCents} tone="orange" /></div></section>
        <section className="panel"><div className="panel-header"><div><div className="panel-title">项目风险</div><div className="panel-subtitle">规则自动识别</div></div><span className={`badge ${data.risks.length ? "danger" : "success"}`}>{data.risks.length ? `${data.risks.length} 项` : "正常"}</span></div><div className="risk-alerts">{data.risks.length ? data.risks.map((risk) => <div className={`risk-alert ${risk.tone}`} key={risk.label}><AlertTriangle /><span>{risk.label}</span>{risk.value ? <strong>{formatMoney(risk.value, true)}</strong> : null}</div>) : <div className="attachment-empty">当前无经营风险提示</div>}</div></section>
      </div>
      <div className="project-overview-grid"><section className="panel"><div className="panel-header"><div><div className="panel-title">应收与质保节点</div><div className="panel-subtitle">逾期、未来回款和质保释放</div></div><Link className="panel-link" href={`/projects/${projectId}?tab=receivables`}>查看明细</Link></div><SimpleTable columns={[{ key: "nodeName", label: "节点" }, { key: "amountCents", label: "应收", format: "money", align: "right" }, { key: "receivedCents", label: "已收", format: "money", align: "right" }, { key: "dueDate", label: "预计日期", format: "date" }, { key: "status", label: "状态", format: "status" }]} rows={data.receivables.slice(0, 8)} /></section>
        <section className="panel"><div className="panel-header"><div><div className="panel-title">业务时间线</div><div className="panel-subtitle">来自审批、收付款、订单和审计记录</div></div></div><div className="detail-section timeline-list">{data.timeline.slice(0, 10).map((event) => <div className={`timeline-item ${event.tone}`} key={event.id}><strong>{event.label}</strong><div>{event.actor}</div><div className="timeline-time">{formatDate(event.happenedAt)}</div></div>)}</div></section></div>
    </> : tab === "attachments" ? <AttachmentPanel objectType="project" objectId={projectId} canUpload={can(user, "projects", "write")} title="项目附件" /> : <div className="project-sections">{sections.map((section) => <section className="panel" key={section.title}><div className="panel-header"><div><div className="panel-title">{section.title}</div>{section.subtitle ? <div className="panel-subtitle">{section.subtitle}</div> : null}</div></div><SimpleTable columns={section.columns} rows={section.rows} /></section>)}</div>}
  </main>;
}
