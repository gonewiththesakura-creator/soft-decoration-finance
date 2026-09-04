import Link from "next/link";
import { AlertTriangle, ArrowRight, CheckSquare2, CircleDollarSign, Clock3, FileWarning, FolderKanban, Landmark } from "lucide-react";
import { requireSession, getCompanyScope } from "@/lib/auth";
import { getDashboardData } from "@/data/dashboard";
import { getDashboardAnalytics } from "@/data/analytics/dashboard";
import { CashflowAreaChart } from "@/components/charts/cashflow-area-chart";
import { CashflowBarChart } from "@/components/charts/cashflow-bar-chart";
import { CompanyFundsDonut } from "@/components/charts/donut-chart";
import { ProjectHealthChart } from "@/components/charts/project-health-chart";
import { MetricCountUp } from "@/components/charts/metric-count-up";
import { AIInsightPanel } from "@/components/ai-insight-panel";
import { formatDate, formatMoney, getStatusTone } from "@/lib/format";

export default async function DashboardPage() {
  const user = await requireSession();
  const scope = await getCompanyScope(user);
  const data = await getDashboardData(user, scope);
  const analytics = await getDashboardAnalytics(user, scope, data.summary.balance);
  const approvalHref = user.role === "finance" ? "/payment-requests" : "/purchase-requests";
  const projectedBalance = analytics.cashflow.at(-1)?.balanceCents ?? data.summary.balance;
  const firstGap = analytics.cashflow.find((point) => point.balanceCents < 0);
  const receivable30 = analytics.cashflow.reduce((sum, row) => sum + row.receivableCents, 0);
  const payable30 = analytics.cashflow.reduce((sum, row) => sum + row.payableCents, 0);
  const actions = [
    { label: "待审批", value: `${data.summary.pendingPurchases + data.summary.pendingPayments} 笔`, detail: `采购 ${data.summary.pendingPurchases} · 付款 ${data.summary.pendingPayments}`, href: approvalHref, icon: CheckSquare2, tone: "warning" },
    { label: "逾期应收", value: formatMoney(data.summary.overdueReceivables, true), detail: "优先跟进已过计划日的款项", href: "/receivables", icon: Clock3, tone: data.summary.overdueReceivables > 0 ? "danger" : "neutral" },
    { label: "超预算项目", value: `${data.overBudget.length} 个`, detail: data.overBudget[0] ? `最高超 ${formatMoney(data.overBudget[0].orderedCents - data.overBudget[0].budgetCents, true)}` : "当前没有超预算项目", href: "/projects", icon: AlertTriangle, tone: data.overBudget.length ? "danger" : "neutral" },
    { label: "供应商欠票", value: formatMoney(data.summary.missingInvoice, true), detail: "应付口径待收进项票", href: "/invoices", icon: FileWarning, tone: data.summary.missingInvoice > 0 ? "warning" : "neutral" },
  ];

  return <main className="content operating-page dashboard-os os-page-enter">
    <header className="operating-heading">
      <div><div className="eyebrow">经营驾驶舱 · 未来 30 天</div><h1>{user.name}，先看资金与需要处理的事</h1><p className="page-description">经营结论、风险和行动均来自当前权限范围内的实时业务数据。</p></div>
      <div className="heading-actions"><Link className="button" href="/projects"><FolderKanban />项目总账</Link><Link className="button primary" href={approvalHref}><CheckSquare2 />处理审批</Link></div>
    </header>

    {["owner", "finance", "project_manager"].includes(user.role) ? <AIInsightPanel eyebrow="Daily Brief" title="今日经营简报" description="让 AI 汇总现金、回款、付款、审批与项目健康，并给出今天的处理顺序。" prompt="请生成今日经营简报。必须先读取经营驾驶舱数据，按资金、回款、付款、审批、项目风险给出有数据依据的处理优先级。" pageContext={{ pathname: "/dashboard", pageType: "dashboard" }} /> : null}

    <div className="dashboard-command-grid">
      <section className="os-section cashflow-command">
        <div className="os-section-header"><div><span className="section-kicker">现金流动态</span><h2>未来余额预计为 <strong className={projectedBalance < 0 ? "danger-text" : "success-text"}>{formatMoney(projectedBalance, true)}</strong></h2><p>以当前账户余额为起点，叠加未来 30 天应收与应付。</p></div><Landmark aria-hidden="true" /></div>
        <div className="cashflow-summary os-stagger">
          <div><span>当前资金</span><strong><MetricCountUp valueCents={data.summary.balance} /></strong></div>
          <div><span>预计收款</span><strong className="success-text"><MetricCountUp valueCents={receivable30} /></strong></div>
          <div><span>预计付款</span><strong className="warning-text"><MetricCountUp valueCents={payable30} /></strong></div>
          <div><span>预计余额</span><strong className={projectedBalance < 0 ? "danger-text" : ""}><MetricCountUp valueCents={projectedBalance} /></strong></div>
        </div>
        {firstGap ? <div className="cash-gap-alert"><AlertTriangle /><span>预计在 {formatDate(firstGap.date)} 出现资金缺口，建议提前安排回款或调整付款计划。</span><strong>{formatMoney(Math.abs(firstGap.balanceCents), true)}</strong></div> : <div className="cash-gap-clear"><CircleDollarSign /><span>未来 30 天暂未发现预计资金缺口。</span></div>}
        <CashflowAreaChart data={analytics.cashflow} />
      </section>

      <aside className="action-center" aria-label="今日行动中心">
        <div className="action-center-head"><div><span className="section-kicker">Action Center</span><h2>今日行动</h2></div><strong>{actions.filter((item) => item.tone !== "neutral").length}</strong></div>
        <div className="action-list os-stagger">{actions.map((item) => <Link className={`action-item ${item.tone}`} href={item.href} key={item.label}><item.icon aria-hidden="true" /><div><span>{item.label}</span><strong>{item.value}</strong><small>{item.detail}</small></div><ArrowRight aria-hidden="true" /></Link>)}</div>
        <div className="action-center-foot"><span>进行中项目</span><strong>{data.summary.activeProjects} 个</strong><Link href="/projects">查看项目状态 <ArrowRight /></Link></div>
      </aside>
    </div>

    <div className="dashboard-insight-grid">
      <section className="os-section">
        <div className="os-section-header"><div><span className="section-kicker">项目组合</span><h2>项目健康度与资金效率</h2><p>低分项目优先展示，同时对照预算占用与回款率。</p></div><Link className="panel-link" href="/projects">进入项目中心</Link></div>
        <ProjectHealthChart data={analytics.projectHealth} />
        <div className="health-links">{analytics.projectHealth.slice(0, 3).map((project) => <Link href={`/projects/${project.id}`} key={project.id}><span className={`health-dot ${project.tone}`} /> <strong>{project.name}</strong><small>{project.label} · {project.score} 分</small><ArrowRight /></Link>)}</div>
      </section>
      <section className="os-section">
        <div className="os-section-header"><div><span className="section-kicker">资金结构</span><h2>公司资金分布</h2><p>当前在用账户余额，按公司汇总。</p></div></div>
        <CompanyFundsDonut data={data.balances.map((row) => ({ label: row.name, valueCents: row.balanceCents }))} />
        <div className="compact-balance-list">{data.balances.map((row) => <div key={row.id}><span>{row.name}<small>{row.accountCount} 个账户</small></span><strong>{formatMoney(row.balanceCents, true)}</strong></div>)}</div>
      </section>
    </div>

    <section className="os-section dashboard-flow-compare">
      <div className="os-section-header"><div><span className="section-kicker">到期结构</span><h2>未来 30 天应收与应付</h2><p>按周汇总计划金额，识别资金压力集中的时间段。</p></div><Link className="panel-link" href="/finance-workspace">财务工作台</Link></div>
      <CashflowBarChart data={analytics.weeklyCashflow} />
    </section>

    <section className="os-section recent-business">
      <div className="os-section-header"><div><span className="section-kicker">Drill-down</span><h2>近期业务明细</h2><p>仅保留最近到期的应收与应付，完整记录在对应台账中查看。</p></div><Link className="panel-link" href="/receivables">查看全部</Link></div>
      <div className="table-scroll"><table className="data-table"><thead><tr><th>预计日期</th><th>类型</th><th>项目 / 往来单位</th><th className="right">金额</th><th>状态</th></tr></thead><tbody>{data.cashflow.slice(0, 8).map((row, index) => <tr key={`${row.type}-${index}`}><td>{formatDate(row.dueDate)}</td><td><span className={`badge ${row.type === "应收" ? "success" : "warning"}`}>{row.type}</span></td><td><div className="table-primary">{row.projectName}</div><div className="table-secondary">{row.counterparty}</div></td><td className="right money">{formatMoney(row.amountCents)}</td><td><span className={`badge ${getStatusTone(row.status)}`}>{row.status}</span></td></tr>)}</tbody></table></div>
    </section>
  </main>;
}
