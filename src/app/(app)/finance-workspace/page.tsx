import { notFound } from "next/navigation";
import { FinanceWorkspace } from "@/components/finance-workspace";
import { getFinanceWorkspace } from "@/data/finance-workspace";
import { getCompanyScope, requireSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { formatMoney } from "@/lib/format";

export default async function FinanceWorkspacePage() { const user = await requireSession(); if (!can(user, "accounts")) notFound(); const selected = await getCompanyScope(user); const data = await getFinanceWorkspace(user, selected); const metrics = [["今日应收", data.summary.todayReceivable], ["今日应付", data.summary.todayPayable], ["逾期应收", data.summary.overdueReceivable], ["已审批待付款", data.summary.approvedPayments], ["供应商欠票", data.summary.missingInvoice], ["今日资金余额", data.summary.balance]] as const; return <main className="content workspace-page"><div className="page-heading"><div><div className="eyebrow">财务执行</div><h1>财务工作台</h1><p className="page-description">按到期、逾期、付款审批和发票缺口组织今日工作。</p></div></div><section className="metric-grid">{metrics.map(([label, value]) => <div className={`metric ${label.includes("逾期") && value > 0 ? "danger" : label.includes("待付款") || label.includes("欠票") ? "warning" : ""}`} key={label}><div className="metric-label">{label}</div><div className="metric-value">{formatMoney(value, true)}</div></div>)}</section><FinanceWorkspace data={{ ...data, receivables: data.receivables as Item[], payables: data.payables as Item[], payments: data.payments as Item[], supplierInvoices: data.supplierInvoices as Item[], customerInvoices: data.customerInvoices as Item[] }} role={user.role} /></main>; }

type Item = Record<string, unknown> & { id: number; kind: string; priority: string };
