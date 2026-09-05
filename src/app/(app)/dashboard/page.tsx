import Link from "next/link";
import { ArrowRight, Landmark } from "lucide-react";
import { requireSession, getCompanyScope } from "@/lib/auth";
import { getDashboardData } from "@/data/dashboard";
import { getDashboardAnalytics } from "@/data/analytics/dashboard";
import { CashflowAreaChart } from "@/components/charts/cashflow-area-chart";
import { CashflowBarChart } from "@/components/charts/cashflow-bar-chart";
import { CompanyFundsDonut } from "@/components/charts/donut-chart";
import { ProjectHealthChart } from "@/components/charts/project-health-chart";
import { PayableMaturityChart, ReceivableAgingChart } from "@/components/charts/aging-chart";
import { ChartEmpty } from "@/components/charts/chart-shell";
import { AIInsightPanel } from "@/components/ai-insight-panel";
import { ActionCenter, type ExecutiveAction } from "@/components/executive/action-center";
import { DashboardHero, type ExecutivePriority } from "@/components/executive/dashboard-hero";
import { ExecutiveMetricCard } from "@/components/executive/executive-metric-card";
import { ExecutiveSection } from "@/components/executive/executive-section";
import { formatDate, formatMoney, getStatusTone } from "@/lib/format";
import { can } from "@/lib/permissions";

function greetingForShanghai() {
  const hour = Number(new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", hour12: false, timeZone: "Asia/Shanghai" }).format(new Date()).slice(0, 2));
  if (hour < 11) return "上午好";
  if (hour < 14) return "中午好";
  if (hour < 18) return "下午好";
  return "晚上好";
}

export default async function DashboardPage() {
  const user = await requireSession();
  const scope = await getCompanyScope(user);
  const data = await getDashboardData(user, scope);
  const analytics = await getDashboardAnalytics(user, scope, data.summary.balance);
  const projectedBalance = data.summary.balanceAccessible ? analytics.cashflow.at(-1)?.balanceCents ?? data.summary.balance : null;
  const firstGap = analytics.cashflow.find((point) => point.balanceCents < 0);
  const receivable30 = data.summary.receivable30;
  const payable30 = data.summary.payable30;
  const pendingPurchases = data.summary.pendingPurchases ?? 0;
  const pendingPurchaseCents = data.summary.pendingPurchaseCents ?? 0;
  const approvalCount = pendingPurchases + (data.summary.pendingPayments ?? 0);
  const approvalCents = pendingPurchaseCents + (data.summary.pendingPaymentCents ?? 0);
  const aiBriefEnabled = ["owner", "finance", "project_manager"].includes(user.role);
  const financeHref = data.summary.balanceAccessible && can(user, "accounts") ? "/finance-workspace" : undefined;
  const approvalHref = data.summary.pendingPayments && can(user, "payment-requests") ? "/payment-requests" : pendingPurchases && can(user, "purchase-requests") ? "/purchase-requests" : undefined;
  const invoiceHref = can(user, "invoices") ? "/invoices" : can(user, "payables") ? "/payables?invoice=missing" : undefined;
  const priorities: ExecutivePriority[] = [
    ...data.overBudget.slice(0, 1).map((item) => ({ label: `${item.name} 预算已超支`, detail: `超出 ${formatMoney(item.orderedCents - item.budgetCents, true)}`, href: `/projects/${item.id}`, tone: "danger" as const })),
    ...data.overdue.slice(0, 1).map((item) => ({ label: `${item.customerName} 应收已逾期`, detail: `${item.overdueDays} 天 · ${formatMoney(item.amountCents, true)}`, href: `/receivables?overdue=true&projectId=${item.projectId}`, tone: "danger" as const })),
    ...(approvalCount && approvalHref ? [{ label: `${approvalCount} 笔申请等待审批`, detail: `合计 ${formatMoney(approvalCents, true)}`, href: approvalHref, tone: "warning" as const }] : []),
    ...(!data.overBudget.length && !data.overdue.length && !approvalCount ? [{ label: "经营节奏稳定", detail: "可继续关注未来回款与项目交付", href: "/projects", tone: "opportunity" as const }] : []),
  ];
  const actions: ExecutiveAction[] = [
    ...data.pending.map((item) => ({ id: `pending-${item.kind}-${item.id}`, type: item.kind as "采购审批" | "付款审批", title: item.number, project: item.projectName, amountCents: item.amountCents, time: item.createdAt, risk: item.amountCents >= 500_000_00 ? "high" as const : "medium" as const, reason: "申请已进入待审批队列", suggestion: "核对预算、票据与付款条件后人工决策", href: item.kind === "付款审批" ? `/payment-requests${user.role === "owner" || user.role === "finance" ? `?open=${item.id}` : ""}` : `/purchase-requests${user.role === "owner" ? `?open=${item.id}` : ""}` })),
    ...data.overdue.slice(0, 3).map((item) => ({ id: `overdue-${item.id}`, type: "逾期应收" as const, title: item.customerName, project: item.projectName, amountCents: item.amountCents, time: item.dueDate, risk: item.overdueDays > 60 ? "high" as const : "medium" as const, reason: `超过计划收款日 ${item.overdueDays} 天`, suggestion: "确认回款承诺并安排今日催收", href: `/receivables?overdue=true&projectId=${item.projectId}` })),
    ...data.overBudget.slice(0, 2).map((item) => ({ id: `budget-${item.id}`, type: "超预算" as const, title: item.code, project: item.name, amountCents: item.orderedCents - item.budgetCents, risk: "high" as const, reason: "累计下单金额已超过当前预算", suggestion: "复核变更预算或暂停后续采购", href: `/projects/${item.id}?tab=budgets` })),
    ...data.missingInvoiceSuppliers.slice(0, 2).map((item) => ({ id: `invoice-${item.supplierId}`, type: "供应商欠票" as const, title: item.supplierName, project: `${item.payableCount} 笔应付`, amountCents: item.amountCents, risk: "medium" as const, reason: "应付金额尚未获得足额进项发票覆盖", suggestion: "付款前确认开票计划与票据风险", href: `/suppliers/${item.supplierId}?tab=invoices` })),
  ].sort((left, right) => Number(right.risk === "high") - Number(left.risk === "high") || right.amountCents - left.amountCents);
  const cashTrend = analytics.cashflow.filter((_, index) => index % 5 === 0).map((point) => point.balanceCents);
  const projectRiskCount = analytics.projectHealth.filter((project) => project.tone !== "healthy").length;
  const date = new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", day: "numeric", weekday: "long", timeZone: "Asia/Shanghai" }).format(new Date());

  return <main className="content operating-page executive-dashboard os-page-enter">
    <DashboardHero name={user.name} greeting={greetingForShanghai()} date={date} scopeLabel={data.scopeLabel} balanceCents={data.summary.balance} balanceAccessible={data.summary.balanceAccessible} projectedBalanceCents={projectedBalance} gapDate={firstGap ? formatDate(firstGap.date) : undefined} priorities={priorities} aiEnabled={aiBriefEnabled} />

    <section className="executive-metrics" aria-label="核心经营指标">
      <ExecutiveMetricCard primary label="当前资金余额" valueCents={data.summary.balance} accessible={data.summary.balanceAccessible} detail="在用账户实时汇总" insight={data.balances.slice(0, 3).map((item) => `${item.name} · ${formatMoney(item.balanceCents, true)}`)} href={financeHref} icon="balance" tone="success" trend={cashTrend} />
      <ExecutiveMetricCard primary label="未来 30 天预计余额" valueCents={projectedBalance} accessible={data.summary.balanceAccessible} detail={firstGap ? `${formatDate(firstGap.date)} 预计出现缺口` : "预测期内暂未发现缺口"} insight={[`预计收款 ${receivable30 === null ? "无权限" : formatMoney(receivable30, true)}`, `预计付款 ${payable30 === null ? "无权限" : formatMoney(payable30, true)}`]} href={financeHref} icon="balance" tone={firstGap ? "danger" : "success"} trend={cashTrend} />
      <ExecutiveMetricCard label="逾期应收" valueCents={data.summary.overdueReceivables} accessible={data.summary.receivableAccessible} detail={`${data.overdue.length} 个重点回款事项`} insight={data.overdue.slice(0, 3).map((item) => `${item.customerName} · ${formatMoney(item.amountCents, true)}`)} href="/receivables?overdue=true" icon="receivable" tone={Number(data.summary.overdueReceivables ?? 0) > 0 ? "danger" : "neutral"} />
      <ExecutiveMetricCard label="待审批采购 / 付款" count={approvalCount} detail={`合计 ${formatMoney(approvalCents, true)}`} insight={[data.summary.purchaseRequestAccessible ? `采购 ${pendingPurchases} 笔` : "采购审批不在当前权限范围", data.summary.paymentApprovalAccessible ? `付款 ${data.summary.pendingPayments ?? 0} 笔` : "付款审批不在当前权限范围"]} href={approvalHref} icon="approvals" tone={approvalCount ? "warning" : "neutral"} />
      <ExecutiveMetricCard label="风险项目" count={projectRiskCount} detail={`进行中 ${data.summary.activeProjects} 个`} insight={analytics.projectHealth.slice(0, 3).map((item) => `${item.name} · ${item.score} 分`)} href="/projects" icon="risk" tone={projectRiskCount ? "danger" : "neutral"} />
      <ExecutiveMetricCard label="供应商欠票" valueCents={data.summary.missingInvoice} accessible={data.summary.payableAccessible} detail={`${data.missingInvoiceSuppliers.length} 家重点供应商`} insight={data.missingInvoiceSuppliers.slice(0, 3).map((item) => `${item.supplierName} · ${formatMoney(item.amountCents, true)}`)} href={invoiceHref} icon="invoices" tone={Number(data.summary.missingInvoice ?? 0) > 0 ? "warning" : "neutral"} />
      <ExecutiveMetricCard label="进行中项目" count={data.summary.activeProjects} detail="当前授权项目范围" insight={analytics.projectHealth.slice(0, 3).map((item) => `${item.name} · ${item.label}`)} href="/projects" icon="projects" />
    </section>

    <div className="dashboard-command-grid executive-command-grid">
      <ExecutiveSection kicker="Cashflow Intelligence" title={projectedBalance === null ? "未来 30 天现金流" : `预计期末余额 ${formatMoney(projectedBalance, true)}`} description="当前余额叠加每日预计收款与付款；点击日期进入资金明细。" className="cashflow-command" action={<Landmark aria-hidden="true" />}>
        {analytics.cashflow.length ? <><div className="cashflow-summary"><div><span>当前资金</span><strong>{formatMoney(data.summary.balance ?? 0, true)}</strong></div><div><span>预计收款</span><strong className="success-text">{formatMoney(receivable30 ?? 0, true)}</strong></div><div><span>预计付款</span><strong className="warning-text">{formatMoney(payable30 ?? 0, true)}</strong></div><div><span>最低余额</span><strong className={Math.min(...analytics.cashflow.map((point) => point.balanceCents)) < 0 ? "danger-text" : ""}>{formatMoney(Math.min(...analytics.cashflow.map((point) => point.balanceCents)), true)}</strong></div></div><CashflowAreaChart data={analytics.cashflow} /></> : <ChartEmpty title="当前账号无权查看账户余额" detail="现金流预测未使用 0 代替不可访问的余额。" />}
      </ExecutiveSection>
      <ActionCenter actions={actions} />
    </div>

    <div id="daily-brief" className="executive-ai-brief">{aiBriefEnabled ? <AIInsightPanel eyebrow="Daily Brief" title="今日经营简报" description="让 AI 基于当前授权数据汇总资金、回款、审批和项目风险。" prompt="请生成今日经营简报。必须先读取经营驾驶舱数据，按资金、回款、付款、审批、项目风险给出有数据依据的处理优先级。" pageContext={{ pathname: "/dashboard", pageType: "dashboard" }} /> : null}</div>

    <div className="dashboard-insight-grid">
      <ExecutiveSection kicker="Project Health" title="风险项目优先" description={user.role === "owner" || user.role === "finance" || user.role === "project_manager" ? "健康分综合回款、预算、欠票与现金净额；点击项目进入总账。" : "健康分基于当前可见的预算与交付进度；点击项目进入总账。"} action={<Link className="panel-link" href="/projects">全部项目 <ArrowRight /></Link>}><ProjectHealthChart data={analytics.projectHealth} /></ExecutiveSection>
      <ExecutiveSection kicker="Fund Structure" title="集团资金结构" description="悬停查看占比，点击公司切换当前数据范围。"><CompanyFundsDonut data={data.balances.map((row) => ({ id: row.id, label: row.name, valueCents: row.balanceCents }))} /><div className="compact-balance-list">{data.balances.map((row) => <div key={row.id}><span>{row.name}<small>{row.accountCount} 个账户</small></span><strong>{formatMoney(row.balanceCents, true)}</strong></div>)}</div></ExecutiveSection>
    </div>

    <div className="executive-aging-grid">
      <ExecutiveSection kicker="Receivable Aging" title="应收账龄" description="点击账龄区间进入应收台账。"><ReceivableAgingChart data={analytics.receivableAging} /></ExecutiveSection>
      <ExecutiveSection kicker="Payable Maturity" title="应付到期结构" description="点击到期区间进入应付台账。"><PayableMaturityChart data={analytics.payableMaturity} /></ExecutiveSection>
    </div>

    <ExecutiveSection kicker="Business Trend" title="未来 30 天应收与应付" description="按周汇总计划金额，识别资金压力集中的时间段。" className="dashboard-flow-compare" action={<Link className="panel-link" href="/finance-workspace">财务工作台</Link>}><CashflowBarChart data={analytics.weeklyCashflow} /></ExecutiveSection>

    <ExecutiveSection kicker="Recent Drill-down" title="近期关键明细" description="表格保持在页面底部，完整记录进入对应业务台账查看。" className="recent-business" action={data.summary.receivableAccessible ? <Link className="panel-link" href="/receivables">查看全部</Link> : data.summary.payableAccessible ? <Link className="panel-link" href="/payables">查看全部</Link> : undefined}>
      <div className="table-scroll"><table className="data-table"><thead><tr><th>预计日期</th><th>类型</th><th>项目 / 往来单位</th><th className="right">金额</th><th>状态</th></tr></thead><tbody>{data.cashflow.slice(0, 8).map((row) => <tr key={`${row.type}-${row.id}`} className="clickable"><td>{formatDate(row.dueDate)}</td><td><span className={`badge ${row.type === "应收" ? "success" : "warning"}`}>{row.type}</span></td><td><Link className="business-link" href={row.type === "应收" ? `/receivables?rowId=${row.id}&projectId=${row.projectId}` : `/payables/${row.id}`}><span className="table-primary">{row.projectName}</span><span className="table-secondary">{row.counterparty}</span></Link></td><td className="right money">{formatMoney(row.amountCents)}</td><td><span className={`badge ${getStatusTone(row.status)}`}>{row.status}</span></td></tr>)}</tbody></table></div>
    </ExecutiveSection>
  </main>;
}
