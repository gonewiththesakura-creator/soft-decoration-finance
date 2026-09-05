import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, Banknote, CalendarClock, CircleDollarSign, Clock3, FileWarning } from "lucide-react";
import { FinanceWorkspace } from "@/components/finance-workspace";
import { CashflowAreaChart } from "@/components/charts/cashflow-area-chart";
import { ReceivableAgingChart, PayableMaturityChart } from "@/components/charts/aging-chart";
import { MetricCountUp } from "@/components/charts/metric-count-up";
import { AIInsightPanel } from "@/components/ai-insight-panel";
import { getFinanceWorkspace } from "@/data/finance-workspace";
import { getFinanceAnalytics } from "@/data/analytics/finance";
import { getCompanyScope, requireSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { formatDate, formatMoney, getStatusTone } from "@/lib/format";

type Item = Record<string, unknown> & { id: number; kind: string; priority: string };

export default async function FinanceWorkspacePage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const [user, query] = await Promise.all([requireSession(), searchParams]);
  if (!can(user, "accounts")) notFound();
  const selected = await getCompanyScope(user);
  const focusDate = /^\d{4}-\d{2}-\d{2}$/.test(query.date ?? "") ? query.date : undefined;
  const data = await getFinanceWorkspace(user, selected, focusDate);
  const analytics = await getFinanceAnalytics(user, selected, data.summary.balance);
  const todayActions = ([...data.payments, ...data.receivables, ...data.payables] as Item[]).filter((item) => !focusDate || String(item.dueDate).slice(0, 10) === focusDate).sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate))).slice(0, 6);
  const firstGap = analytics.cashflow.find((point) => point.balanceCents < 0);

  return <main className="content operating-page finance-os os-page-enter">
    <header className="operating-heading"><div><div className="eyebrow">财务执行 · 资金优先</div><h1>财务工作台</h1><p className="page-description">{focusDate ? `正在聚焦 ${formatDate(focusDate)} 的应收与应付到期事项。` : "先判断资金趋势和到期压力，再进入今日执行队列。"}</p></div><div className="heading-actions">{focusDate ? <Link className="button" href="/finance-workspace">清除日期聚焦</Link> : null}<Link className="button" href="/accounts"><CircleDollarSign />资金账户</Link><Link className="button primary" href="/receipts?new=1"><Banknote />登记收款</Link></div></header>

    <AIInsightPanel eyebrow="Finance AI" title="资金与到期风险分析" description="基于当前公司范围复核未来 30 天现金流、逾期应收和近期应付。" prompt="请分析当前财务工作台：先读取 30 天现金流、逾期应收和未来 7 天应付，指出最紧迫的资金风险、数据依据和人工处理建议。" pageContext={{ pathname: "/finance-workspace", pageType: "finance_workspace" }} />

    <div className="finance-command-grid">
      <section className="os-section finance-cash-section">
        <div className="os-section-header"><div><span className="section-kicker">资金预测</span><h2>未来 30 天资金曲线</h2><p>当前账户余额叠加已录入的应收、应付到期计划。</p></div>{firstGap ? <span className="badge danger">{formatDate(firstGap.date)} 预计缺口</span> : <span className="badge success">暂未发现缺口</span>}</div>
        <div className="finance-balance-horizon os-stagger">
          <div><span>今日资金</span><strong><MetricCountUp valueCents={analytics.balanceToday} /></strong><small>当前在用账户</small></div>
          <div><span>7 天预计</span><strong className={analytics.balance7 < 0 ? "danger-text" : ""}><MetricCountUp valueCents={analytics.balance7} /></strong><small>含 7 天内收支</small></div>
          <div><span>30 天预计</span><strong className={analytics.balance30 < 0 ? "danger-text" : "success-text"}><MetricCountUp valueCents={analytics.balance30} /></strong><small>含 30 天内收支</small></div>
        </div>
        <CashflowAreaChart data={analytics.cashflow} ariaLabel="财务工作台未来三十天资金趋势" />
      </section>

      <aside className="finance-action-queue" aria-label="今日行动队列">
        <div className="action-center-head"><div><span className="section-kicker">Today</span><h2>今日行动队列</h2></div><strong>{todayActions.length}</strong></div>
        <div className="finance-priority-strip"><div><Clock3 /><span>逾期应收</span><strong>{formatMoney(data.summary.overdueReceivable, true)}</strong></div><div><FileWarning /><span>欠票金额</span><strong>{formatMoney(data.summary.missingInvoice, true)}</strong></div></div>
        <div className="finance-action-list">{todayActions.length ? todayActions.map((item) => <Link href={item.kind === "payment" ? "/payment-requests" : item.kind === "receivable" ? `/projects/${item.projectId}?tab=receivables` : `/projects/${item.projectId}?tab=payments`} key={`${item.kind}-${item.id}`}><span className={`badge ${getStatusTone(item.priority)}`}>{item.priority}</span><div><strong>{String(item.title)}</strong><small>{String(item.projectName)} · {formatDate(String(item.dueDate))}</small></div><b>{formatMoney(Number(item.amountCents), true)}</b><ArrowRight /></Link>) : <div className="finance-queue-empty"><CalendarClock /><span>当前没有临近到期事项</span></div>}</div>
        <Link className="finance-queue-all" href="#execution">进入完整执行队列 <ArrowRight /></Link>
      </aside>
    </div>

    <div className="finance-structure-grid">
      <section className="os-section">
        <div className="os-section-header"><div><span className="section-kicker">Receivable Aging</span><h2>应收账龄</h2><p>按未结清应收计划的逾期天数分桶。</p></div><Link className="panel-link" href="/receivables">查看应收台账</Link></div>
        <ReceivableAgingChart data={analytics.receivableAging} />
      </section>
      <section className="os-section">
        <div className="os-section-header"><div><span className="section-kicker">Payable Maturity</span><h2>应付到期结构</h2><p>7 天内包含已逾期未付款项。</p></div><Link className="panel-link" href="/payables">查看应付台账</Link></div>
        <PayableMaturityChart data={analytics.payableMaturity} />
      </section>
    </div>

    <section className="finance-execution" id="execution">
      <div className="execution-heading"><div><span className="section-kicker">Execution</span><h2>行动与业务明细</h2><p>原有应收、应付、付款、发票和账户队列完整保留。</p></div></div>
      <FinanceWorkspace data={{ ...data, receivables: data.receivables as Item[], payables: data.payables as Item[], payments: data.payments as Item[], supplierInvoices: data.supplierInvoices as Item[], customerInvoices: data.customerInvoices as Item[] }} role={user.role} focusDate={focusDate} />
    </section>
  </main>;
}
