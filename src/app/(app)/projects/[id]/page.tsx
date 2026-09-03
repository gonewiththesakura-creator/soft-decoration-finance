import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, ArrowRight, Building2, CalendarDays, CheckCircle2, MapPin, UserRound } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { formatDate, formatMoney, getStatusTone } from "@/lib/format";
import { getProjectDetail, getProjectSections, projectTabs, type ProjectTab } from "@/data/project-detail";
import { getProjectAnalytics } from "@/data/analytics/projects";
import { calculateProjectHealth, percentage } from "@/data/analytics/health";
import { CostCategoryDonut } from "@/components/charts/donut-chart";
import { ProcurementPipeline } from "@/components/charts/procurement-pipeline";
import { ProgressRadials } from "@/components/charts/progress-radials";
import { ProjectCashCurve } from "@/components/charts/project-cash-curve";
import { MetricCountUp } from "@/components/charts/metric-count-up";
import { SimpleTable } from "@/components/simple-table";
import { AttachmentPanel } from "@/components/attachment-panel";

export default async function ProjectDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const [{ id }, query, user] = await Promise.all([params, searchParams, requireSession()]);
  const projectId = Number(id);
  const data = await getProjectDetail(projectId, user);
  if (!data) notFound();
  const tab = projectTabs.some(([key]) => key === query.tab) ? query.tab as ProjectTab : "overview";
  const { project, metrics } = data;
  const [sections, analytics] = await Promise.all([
    tab !== "overview" && tab !== "attachments" ? getProjectSections(projectId, tab) : Promise.resolve([]),
    tab === "overview" ? getProjectAnalytics(projectId) : Promise.resolve(null),
  ]);
  const health = calculateProjectHealth({
    contractCents: project.currentContractCents,
    budgetCents: project.budgetCents,
    receivedCents: metrics.receivedCents,
    orderedCents: metrics.orderedCents,
    payableCents: metrics.payableCents,
    paidCents: metrics.paidCents,
    purchaseInvoicedCents: metrics.purchaseInvoicedCents,
    overdueReceivableCents: metrics.overdueReceivableCents,
  });
  const progress = [
    { label: "回款", value: percentage(metrics.receivedCents, project.currentContractCents), detail: `${formatMoney(metrics.receivedCents, true)} / ${formatMoney(project.currentContractCents, true)}` },
    { label: "采购", value: percentage(metrics.orderedCents, project.budgetCents), detail: `${formatMoney(metrics.orderedCents, true)} / ${formatMoney(project.budgetCents, true)}` },
    { label: "到货", value: percentage(metrics.deliveredCents, metrics.orderedCents), detail: `${formatMoney(metrics.deliveredCents, true)} / ${formatMoney(metrics.orderedCents, true)}` },
    { label: "付款", value: percentage(metrics.paidCents, metrics.payableCents), detail: `${formatMoney(metrics.paidCents, true)} / ${formatMoney(metrics.payableCents, true)}` },
    { label: "发票", value: percentage(metrics.purchaseInvoicedCents, metrics.payableCents), detail: `${formatMoney(metrics.purchaseInvoicedCents, true)} / ${formatMoney(metrics.payableCents, true)}` },
  ];

  return <main className="content operating-page project-os os-page-enter">
    <header className="project-command-header">
      <div className="project-identity"><div className="project-code">{project.code}</div><h1 className="project-name">{project.name}</h1><div className="project-meta"><span><Building2 />{project.companyName}</span><Link href={`/customers/${project.customerId}`}><UserRound />{project.customerName}</Link><span><UserRound />项目经理 {project.managerName}</span><span><UserRound />设计师 {project.designerName}</span><span><CalendarDays />{formatDate(project.startDate)} 至 {formatDate(project.expectedEndDate)}</span><span><MapPin />{project.address || "未填写地址"}</span></div></div>
      <div className="project-command-status"><span className={`badge ${getStatusTone(project.status)}`}>{project.status}</span><div className={`health-score ${health.tone}`}><div><span>经营健康分</span><strong>{health.score}</strong><small>/ 100</small></div><b>{health.label}</b></div><p>{health.reasons[0] ?? "当前关键经营指标稳定"}</p></div>
    </header>
    <nav className="tabs project-tabs" aria-label="项目详情导航">{projectTabs.map(([key, label]) => <Link key={key} href={`/projects/${projectId}?tab=${key}`} className={`tab ${tab === key ? "active" : ""}`}>{label}</Link>)}</nav>

    {tab === "overview" && analytics ? <>
      <section className="project-conclusion-strip os-stagger" aria-label="项目核心经营结论">
        <div><span>当前合同</span><strong><MetricCountUp valueCents={project.currentContractCents} /></strong><small>原合同 {formatMoney(project.originalContractCents, true)}</small></div>
        <div><span>采购预算占用</span><strong className={metrics.remainingBudgetCents < 0 ? "danger-text" : ""}>{percentage(metrics.orderedCents, project.budgetCents)}%</strong><small>{metrics.remainingBudgetCents < 0 ? `超预算 ${formatMoney(-metrics.remainingBudgetCents, true)}` : `剩余 ${formatMoney(metrics.remainingBudgetCents, true)}`}</small></div>
        <div><span>项目资金净额</span><strong className={metrics.projectCashCents < 0 ? "danger-text" : "success-text"}><MetricCountUp valueCents={metrics.projectCashCents} /></strong><small>已收减已付</small></div>
        <div><span>逾期应收</span><strong className={metrics.overdueReceivableCents > 0 ? "danger-text" : ""}><MetricCountUp valueCents={metrics.overdueReceivableCents} /></strong><small>未来 30 天应收 {formatMoney(metrics.futureReceivableCents, true)}</small></div>
      </section>

      <div className="project-primary-grid">
        <section className="os-section">
          <div className="os-section-header"><div><span className="section-kicker">经营进度</span><h2>五项关键进度</h2><p>回款、采购、到货、付款与进项发票使用当前有效金额计算。</p></div></div>
          <ProgressRadials data={progress} />
        </section>
        <section className="os-section project-risk-section">
          <div className="os-section-header"><div><span className="section-kicker">风险判断</span><h2>{data.risks.length ? `${data.risks.length} 项需要关注` : "当前经营状态稳定"}</h2><p>由预算、应收、欠票、审批和日期规则自动识别。</p></div>{data.risks.length ? <AlertTriangle aria-hidden="true" /> : <CheckCircle2 aria-hidden="true" />}</div>
          <div className="project-risk-list">{data.risks.length ? data.risks.map((risk) => <div className={`project-risk-item ${risk.tone}`} key={risk.label}><span>{risk.label}</span>{risk.value ? <strong>{formatMoney(risk.value, true)}</strong> : null}</div>) : <div className="risk-clear"><CheckCircle2 /><span>未发现逾期、超预算或现金缺口。</span></div>}</div>
          <Link className="inline-action" href={`/projects/${projectId}?tab=logs`}>查看完整操作记录 <ArrowRight /></Link>
        </section>
      </div>

      <div className="project-chart-grid">
        <section className="os-section">
          <div className="os-section-header"><div><span className="section-kicker">累计收支</span><h2>项目资金曲线</h2><p>以实际确认的收款和付款为准，不使用计划金额替代。</p></div></div>
          <ProjectCashCurve data={analytics.cashCurve} />
        </section>
        <section className="os-section">
          <div className="os-section-header"><div><span className="section-kicker">成本结构</span><h2>采购品类分布</h2><p>按 SKU 最终采购价或预算价归集。</p></div></div>
          <CostCategoryDonut data={analytics.costCategories} />
        </section>
      </div>

      <section className="os-section project-pipeline-section">
        <div className="os-section-header"><div><span className="section-kicker">采购执行</span><h2>SKU 采购 Pipeline</h2><p>按每个 SKU 的报价、审批、订单和到货记录确定当前阶段。</p></div><Link className="panel-link" href={`/projects/${projectId}?tab=procurement`}>查看采购明细</Link></div>
        <ProcurementPipeline data={analytics.pipeline} />
      </section>

      <div className="project-detail-grid">
        <section className="os-section">
          <div className="os-section-header"><div><span className="section-kicker">回款节点</span><h2>应收与质保</h2><p>突出逾期、未来回款和质保释放。</p></div><Link className="panel-link" href={`/projects/${projectId}?tab=receivables`}>查看明细</Link></div>
          <SimpleTable columns={[{ key: "nodeName", label: "节点" }, { key: "amountCents", label: "应收", format: "money", align: "right" }, { key: "receivedCents", label: "已收", format: "money", align: "right" }, { key: "dueDate", label: "预计日期", format: "date" }, { key: "status", label: "状态", format: "status" }]} rows={data.receivables.slice(0, 8)} />
        </section>
        <section className="os-section">
          <div className="os-section-header"><div><span className="section-kicker">业务轨迹</span><h2>近期时间线</h2><p>审批、收付款、订单和审计记录。</p></div></div>
          <div className="timeline-list project-timeline">{data.timeline.slice(0, 10).map((event) => <div className={`timeline-item ${event.tone}`} key={event.id}><strong>{event.label}</strong><div>{event.actor}</div><div className="timeline-time">{formatDate(event.happenedAt)}</div></div>)}</div>
        </section>
      </div>
    </> : tab === "attachments" ? <AttachmentPanel objectType="project" objectId={projectId} canUpload={can(user, "projects", "write")} title="项目附件" /> : <div className="project-sections">{sections.map((section) => <section className="panel" key={section.title}><div className="panel-header"><div><div className="panel-title">{section.title}</div>{section.subtitle ? <div className="panel-subtitle">{section.subtitle}</div> : null}</div></div><SimpleTable columns={section.columns} rows={section.rows} /></section>)}</div>}
  </main>;
}
