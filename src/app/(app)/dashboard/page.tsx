import Link from "next/link";
import { AlertTriangle, ArrowDownLeft, ArrowUpRight, CheckSquare2, FolderKanban, Landmark } from "lucide-react";
import { requireSession, getCompanyScope } from "@/lib/auth";
import { getDashboardData } from "@/data/dashboard";
import { formatDate, formatMoney, getStatusTone } from "@/lib/format";

export default async function DashboardPage() {
  const user = await requireSession(); const scope = await getCompanyScope(user); const data = await getDashboardData(user, scope);
  const approvalHref = user.role === "finance" ? "/payment-requests" : "/purchase-requests";
  const netCashflow = data.summary.receivable30 - data.summary.payable30; const projectedBalance = data.summary.balance + netCashflow; const cashGap = Math.max(0, -projectedBalance);
  const metrics = [
    { label: "三家公司资金余额", value: formatMoney(data.summary.balance, true), meta: `${data.balances.reduce((sum, row) => sum + row.accountCount, 0)} 个在用账户`, icon: Landmark },
    { label: "未来 30 天净现金流", value: formatMoney(netCashflow, true), meta: <span className="cash-equation">{formatMoney(data.summary.balance, true)} + {formatMoney(data.summary.receivable30, true)} - {formatMoney(data.summary.payable30, true)} = {formatMoney(projectedBalance, true)}<br />{cashGap > 0 ? `资金缺口 ${formatMoney(cashGap, true)}` : "预计无资金缺口"}</span>, icon: netCashflow >= 0 ? ArrowDownLeft : ArrowUpRight, tone: cashGap > 0 ? "danger" : "" },
    { label: "待审批采购 / 付款", value: `${data.summary.pendingPurchases + data.summary.pendingPayments} 笔`, meta: `采购 ${data.summary.pendingPurchases} · 付款 ${data.summary.pendingPayments}`, icon: CheckSquare2, tone: data.summary.pendingPurchases + data.summary.pendingPayments > 0 ? "warning" : "" },
    { label: "超预算项目", value: `${data.overBudget.length} 个`, meta: data.overBudget.length ? `最高超 ${formatMoney(data.overBudget[0].orderedCents - data.overBudget[0].budgetCents, true)}` : "当前无超预算项目", icon: AlertTriangle, tone: data.overBudget.length ? "warning" : "" },
    { label: "供应商欠票金额", value: formatMoney(data.summary.missingInvoice, true), meta: "应付口径待收进项票", icon: AlertTriangle, tone: data.summary.missingInvoice > 0 ? "danger" : "" },
    { label: "进行中项目", value: `${data.summary.activeProjects} 个`, meta: "待启动至质保关闭前", icon: FolderKanban },
  ];
  return <main className="content">
    <div className="page-heading"><div><div className="eyebrow">经营驾驶舱</div><h1>{user.name}，这是今天的经营重点</h1><p className="page-description">资金、未来现金流、审批和项目风险均来自实时业务数据。</p></div><div className="heading-actions"><Link className="button" href="/ai">询问 AI 助手</Link><Link className="button primary" href={approvalHref}>处理待审批</Link></div></div>
    <section className="metric-grid">{metrics.map((item) => <div className={`metric ${item.tone ?? ""}`} key={item.label}><div className="metric-label"><span>{item.label}</span><item.icon /></div><div className="metric-value">{item.value}</div><div className="metric-meta">{item.meta}</div></div>)}</section>
    <div className="dashboard-grid">
      <section className="panel"><div className="panel-header"><div><div className="panel-title">未来 30 天收支日历</div><div className="panel-subtitle">逾期与即将到期事项按日期排序</div></div><Link className="panel-link" href="/receivables">查看全部</Link></div><div className="table-scroll"><table className="data-table"><thead><tr><th>预计日期</th><th>类型</th><th>项目 / 往来单位</th><th className="right">金额</th><th>状态</th></tr></thead><tbody>{data.cashflow.map((row, i) => <tr key={`${row.type}-${i}`}><td>{formatDate(row.dueDate)}</td><td><span className={`badge ${row.type === "应收" ? "success" : "warning"}`}>{row.type}</span></td><td><div className="table-primary">{row.projectName}</div><div style={{ color: "var(--muted)", fontSize: 10, marginTop: 2 }}>{row.counterparty}</div></td><td className="right money">{formatMoney(row.amountCents)}</td><td><span className={`badge ${getStatusTone(row.status)}`}>{row.status}</span></td></tr>)}</tbody></table></div></section>
      <section className="panel"><div className="panel-header"><div><div className="panel-title">公司资金</div><div className="panel-subtitle">手工维护余额，按公司隔离</div></div><Link className="panel-link" href="/accounts">维护账户</Link></div><div className="balance-list">{data.balances.map((row) => <div className="balance-row" key={row.id}><div><div className="balance-name">{row.name}</div><div className="balance-meta">{row.accountCount} 个账户</div></div><div className="balance-amount">{formatMoney(row.balanceCents, true)}</div></div>)}</div></section>
    </div>
    <div className="dashboard-grid">
      <section className="panel"><div className="panel-header"><div><div className="panel-title">等待处理</div><div className="panel-subtitle">老板审批后才会进入下单或付款环节</div></div><Link className="panel-link" href="/payment-requests">审批工作台</Link></div><div className="table-scroll"><table className="data-table"><thead><tr><th>事项</th><th>单号</th><th>项目</th><th className="right">金额</th><th>提交时间</th></tr></thead><tbody>{data.pending.map((row) => <tr key={`${row.kind}-${row.id}`}><td><span className="badge warning">{row.kind}</span></td><td className="table-primary">{row.number}</td><td>{row.projectName}</td><td className="right money">{formatMoney(row.amountCents)}</td><td>{formatDate(row.createdAt)}</td></tr>)}</tbody></table></div></section>
      <section className="panel"><div className="panel-header"><div><div className="panel-title">超预算项目</div><div className="panel-subtitle">已下单成本超过当前采购预算</div></div><Link className="panel-link" href="/projects">项目总账</Link></div>{data.overBudget.length ? <div className="risk-list">{data.overBudget.map((row) => <Link href={`/projects/${row.id}`} className="risk-item" key={row.id}><div><div className="risk-name">{row.name}</div><div className="risk-code">{row.code}</div></div><div className="risk-amount">超 {formatMoney(row.orderedCents - row.budgetCents, true)}</div></Link>)}</div> : <div className="empty">当前没有超预算项目</div>}</section>
    </div>
  </main>;
}
