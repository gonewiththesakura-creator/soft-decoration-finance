import Link from "next/link";
import { notFound } from "next/navigation";
import { Building2, Phone, UserRound } from "lucide-react";
import { AttachmentPanel } from "@/components/attachment-panel";
import { SimpleTable } from "@/components/simple-table";
import { customerTabs, getCustomerProfile, getCustomerSections, type CustomerTab } from "@/data/partners";
import { requireSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { formatMoney, getStatusTone } from "@/lib/format";

export default async function CustomerProfilePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const [{ id }, query, user] = await Promise.all([params, searchParams, requireSession()]); if (!can(user, "customers")) notFound();
  const customerId = Number(id); const data = await getCustomerProfile(customerId, user); if (!data) notFound();
  const tab = customerTabs.some(([key]) => key === query.tab) ? query.tab as CustomerTab : "projects"; const sections = tab === "attachments" ? [] : await getCustomerSections(customerId, tab); const { customer, metrics } = data;
  return <main className="content partner-profile"><div className="project-titlebar"><div className="project-title-row"><div><div className="project-code">{String(customer.code)}</div><div className="project-name">{String(customer.name)}</div><div className="project-meta"><span><Building2 />{String(customer.companyName)}</span><span><UserRound />{String(customer.contact || "未填写联系人")}</span><span><Phone />{String(customer.phone || "未填写电话")}</span><span>{String(customer.type)}</span></div></div><span className={`badge ${getStatusTone(String(customer.status))}`}>{customer.status === "active" ? "正常" : String(customer.status)}</span></div></div>
    <section className="partner-metrics">{[["合作项目", `${metrics.projectCount} 个`], ["进行中项目", `${metrics.activeProjectCount} 个`], ["累计合同金额", formatMoney(metrics.contractCents, true)], ["已收款", formatMoney(metrics.receivedCents, true)], ["未收款", formatMoney(metrics.receivableCents, true)], ["逾期金额", formatMoney(metrics.overdueCents, true)], ["已开发票", formatMoney(metrics.invoicedCents, true)], ["未开发票", formatMoney(metrics.uninvoicedCents, true)]].map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</section>
    <nav className="tabs project-tabs">{customerTabs.map(([key, label]) => <Link key={key} href={`/customers/${customerId}?tab=${key}`} className={`tab ${tab === key ? "active" : ""}`}>{label}</Link>)}</nav>
    {tab === "attachments" ? <AttachmentPanel objectType="customer" objectId={customerId} canUpload={can(user, "customers", "write")} title="客户附件" /> : sections.map((section) => <section className="panel" key={section.title}><div className="panel-header"><div className="panel-title">{section.title}</div></div><SimpleTable columns={section.columns} rows={section.rows} /></section>)}
  </main>;
}
