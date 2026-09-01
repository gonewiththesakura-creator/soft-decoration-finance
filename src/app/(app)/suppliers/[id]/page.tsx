import Link from "next/link";
import { notFound } from "next/navigation";
import { Building2, Phone, ReceiptText, UserRound } from "lucide-react";
import { AttachmentPanel } from "@/components/attachment-panel";
import { SimpleTable } from "@/components/simple-table";
import { getSupplierProfile, getSupplierSections, supplierTabs, type SupplierTab } from "@/data/partners";
import { requireSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { formatMoney, getStatusTone } from "@/lib/format";

export default async function SupplierProfilePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const [{ id }, query, user] = await Promise.all([params, searchParams, requireSession()]); if (!can(user, "suppliers")) notFound();
  const supplierId = Number(id); const data = await getSupplierProfile(supplierId, user); if (!data) notFound();
  const tab = supplierTabs.some(([key]) => key === query.tab) ? query.tab as SupplierTab : "overview"; const sections = tab === "attachments" ? [] : await getSupplierSections(supplierId, tab); const { supplier, metrics } = data;
  return <main className="content partner-profile"><div className="project-titlebar"><div className="project-title-row"><div><div className="project-code">{String(supplier.code)}</div><div className="project-name">{String(supplier.name)}</div><div className="project-meta"><span><Building2 />{String(supplier.companyName)}</span><span><UserRound />{String(supplier.contact || "未填写联系人")}</span><span><Phone />{String(supplier.phone || "未填写电话")}</span><span><ReceiptText />{String(supplier.taxNumber || "未填写税号")}</span><span>{String(supplier.category)}</span></div></div><span className={`badge ${getStatusTone(String(supplier.status))}`}>{supplier.status === "active" ? "正常" : String(supplier.status)}</span></div></div>
    <section className="partner-metrics">{[["合作项目", `${metrics.projectCount} 个`], ["进行中采购", `${metrics.ongoingOrderCount} 笔`], ["累计采购额", formatMoney(metrics.orderedCents, true)], ["当前未付款", formatMoney(metrics.remainingCents, true)], ["累计已付款", formatMoney(metrics.paidCents, true)], ["当前欠票", formatMoney(metrics.missingInvoiceCents, true)], ["退换货次数", `${metrics.returnCount} 次`]].map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</section>
    <nav className="tabs project-tabs">{supplierTabs.map(([key, label]) => <Link key={key} href={`/suppliers/${supplierId}?tab=${key}`} className={`tab ${tab === key ? "active" : ""}`}>{label}</Link>)}</nav>
    {tab === "attachments" ? <AttachmentPanel objectType="supplier" objectId={supplierId} canUpload={can(user, "suppliers", "write")} title="供应商附件" /> : sections.map((section) => <section className="panel" key={section.title}><div className="panel-header"><div className="panel-title">{section.title}</div></div><SimpleTable columns={section.columns} rows={section.rows} /></section>)}
  </main>;
}
