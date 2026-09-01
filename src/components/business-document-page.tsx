import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Database, Link2 } from "lucide-react";
import { AttachmentPanel } from "@/components/attachment-panel";
import { getDocumentDetail, type DocumentKind } from "@/data/document-detail";
import { requireSession } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { formatDate, formatMoney, getStatusTone } from "@/lib/format";

const objectTypes: Record<DocumentKind, string> = { "purchase-request": "purchase_request", "purchase-order": "purchase_order", payable: "payable", payment: "payment", contract: "contract" };

export async function BusinessDocumentPage({ kind, id }: { kind: DocumentKind; id: number }) {
  const user = await requireSession(); const data = await getDocumentDetail(kind, id, user); if (!data) notFound(); const { meta, row } = data;
  return <main className="content document-detail"><div className="page-heading"><div><Link className="back-link" href={`/${meta.resource}`}><ArrowLeft />返回{meta.title}列表</Link><div className="eyebrow">{meta.eyebrow}</div><h1>{String(row.number)}</h1><p className="page-description">{String(row.projectName || row.name || meta.title)}</p></div><span className={`badge ${getStatusTone(String(row.status))}`}>{String(row.status)}</span></div>
    <div className="document-grid"><div className="document-main"><section className="panel"><div className="panel-header"><div className="panel-title">单据信息</div></div><div className="document-facts">{data.facts.map((fact) => <div key={fact.label}><span>{fact.label}</span><strong>{fact.format === "money" ? formatMoney(Number(fact.value)) : fact.format === "date" ? formatDate(String(fact.value)) : fact.format === "status" ? <span className={`badge ${getStatusTone(String(fact.value))}`}>{String(fact.value)}</span> : String(fact.value ?? "-")}</strong></div>)}</div></section>
      {data.lineage ? <section className="panel"><div className="panel-header"><div><div className="panel-title">数据来源</div><div className="panel-subtitle">历史迁移数据血缘</div></div><Database /></div><div className="document-facts"><div><span>来源文件</span><strong>{data.lineage.filename}</strong></div><div><span>来源 Sheet</span><strong>{data.lineage.sheetName}</strong></div><div><span>原始行</span><strong>{data.lineage.sourceRow}</strong></div><div><span>导入批次</span><strong>{data.lineage.batchNumber}</strong></div></div></section> : null}
      <AttachmentPanel objectType={objectTypes[kind]} objectId={id} canUpload={can(user, meta.resource, "write")} title="业务附件" /></div>
      <aside className="document-side"><section className="panel"><div className="panel-header"><div className="panel-title">业务关系</div></div><div className="relation-list">{data.relations.map((item) => <Link href={item.href} key={`${item.label}-${item.href}`}><Link2 /><span>{item.label}</span><strong>{item.value}</strong></Link>)}</div></section>
      <section className="panel"><div className="panel-header"><div className="panel-title">业务时间线</div></div><div className="detail-section timeline-list">{data.events.map((event) => <div className={`timeline-item ${event.tone}`} key={event.id}><strong>{event.label}</strong><div>{event.actor}</div><div className="timeline-time">{formatDate(event.happenedAt)}</div></div>)}</div></section></aside></div>
  </main>;
}
