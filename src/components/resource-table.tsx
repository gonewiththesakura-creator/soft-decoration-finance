"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Ban, Check, Download, Eye, FileQuestion, LoaderCircle, Paperclip, Pencil, Plus, Search, X } from "lucide-react";
import type { ColumnDef, FieldDef, ResourceDefinition } from "@/data/resources";
import { formatDate, formatMoney, formatRatio, getStatusTone } from "@/lib/format";
import { ApprovalDetail } from "./approval-detail";
import { AttachmentPanel } from "./attachment-panel";

type Row = Record<string, unknown> & { id: number; status?: string };
type ApprovalTarget = { type: "purchase" | "payment"; id: number };

const editableResources = new Set(["accounts", "customers", "suppliers", "projects", "contracts", "receivables", "skus", "quotes", "purchase-requests", "payment-requests"]);
const voidableResources = new Set(["contracts", "receivables", "receipts", "purchase-requests", "payment-requests", "payments", "invoices", "returns"]);
const detailResources = new Set(["projects", "customers", "suppliers", "contracts", "purchase-requests", "purchase-orders", "payables", "payments"]);
const attachmentObjectTypes: Record<string, string> = { contracts: "contract", receipts: "receipt", skus: "sku", quotes: "quote", "purchase-requests": "purchase_request", "purchase-orders": "purchase_order", payables: "payable", "payment-requests": "payment_request", payments: "payment", invoices: "invoice", returns: "return" };

function Cell({ value, column }: { value: unknown; column: ColumnDef }) {
  if (column.format === "money") return <span className="money">{formatMoney(Number(value))}</span>;
  if (column.format === "date") return <span>{formatDate(value as string)}</span>;
  if (column.format === "ratio") return <span>{formatRatio(Number(value))}</span>;
  if (column.format === "status") return <span className={`badge ${getStatusTone(String(value ?? ""))}`}>{String(value ?? "-")}</span>;
  if (column.format === "number") return <span>{Number(value ?? 0).toLocaleString("zh-CN", { maximumFractionDigits: 4 })}</span>;
  return <span className={column.key === "name" || column.key === "number" || column.key === "code" ? "table-primary" : ""}>{String(value ?? "-")}</span>;
}

function canEditRow(resource: string, row: Row) {
  if (!editableResources.has(resource)) return false;
  if (resource === "contracts") return row.status === "草稿";
  if (resource === "receivables") return Number(row.receivedCents) === 0;
  if (resource === "skus") return row.status !== "已下单";
  if (resource === "quotes") return ["待核价", "未选中"].includes(String(row.status));
  if (resource === "purchase-requests") return ["草稿", "待审批"].includes(String(row.status));
  if (resource === "payment-requests") return row.status === "待审批";
  return true;
}

function fieldValue(field: FieldDef, row: Row | null) {
  if (!row) return "";
  const centsKeys: Record<string, string> = { balanceYuan: "balanceCents", contractYuan: "originalContractCents", budgetYuan: "budgetCents", amountYuan: "amountCents", budgetUnitYuan: "budgetUnitCents", unitPriceYuan: "unitPriceCents", freightYuan: "freightCents", installYuan: "installCents" };
  if (centsKeys[field.key]) return Number(row[centsKeys[field.key]] ?? 0) / 100;
  if (field.key === "ratioPercent") return Number(row.ratioBps ?? 0) / 100;
  if (field.key === "taxRatePercent") return Number(row.taxRateBps ?? 0) / 100;
  if (field.key === "isWarranty") return String(Boolean(row.isWarranty));
  const value = row[field.key];
  if (field.type === "date" && value) return String(value).slice(0, 10);
  return value == null ? "" : String(value);
}

export function ResourceTable({ definition, rows, canWrite, role, autoCreate = false }: { definition: ResourceDefinition; rows: Row[]; canWrite: boolean; role: string; autoCreate?: boolean }) {
  const router = useRouter(); const [query, setQuery] = useState(""); const [showForm, setShowForm] = useState(false); const [editingRow, setEditingRow] = useState<Row | null>(null); const [approval, setApproval] = useState<ApprovalTarget | null>(null); const [attachmentRow, setAttachmentRow] = useState<Row | null>(null); const [error, setError] = useState(""); const [toast, setToast] = useState(""); const [pending, startTransition] = useTransition();
  const filtered = useMemo(() => rows.filter((row) => Object.values(row).some((value) => String(value ?? "").toLowerCase().includes(query.toLowerCase()))), [rows, query]); const fields = definition.fields ?? [];
  function showToast(message: string) { setToast(message); window.setTimeout(() => setToast(""), 2600); }
  function openCreate() { setEditingRow(null); setError(""); setShowForm(true); }
  useEffect(() => { if (autoCreate && canWrite && fields.length) openCreate(); }, [autoCreate, canWrite, fields.length]);
  function openEdit(row: Row) { setEditingRow(row); setError(""); setShowForm(true); }
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); const body = { ...Object.fromEntries(new FormData(event.currentTarget).entries()), ...(editingRow ? { id: editingRow.id } : {}) };
    const response = await fetch(`/api/resources/${definition.key}`, { method: editingRow ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); const data = await response.json();
    if (!response.ok) { setError(data.error ?? "保存失败"); return; }
    setShowForm(false); setEditingRow(null); showToast(editingRow ? "修改已保存并写入审计日志" : "已保存并写入操作日志"); startTransition(() => router.refresh());
  }
  async function voidRow(row: Row) {
    const label = definition.key === "payments" ? "冲销" : definition.key === "receipts" ? "撤销" : "作废"; const reason = window.prompt(`请输入${label}原因`); if (!reason?.trim()) return;
    const response = await fetch(`/api/resources/${definition.key}/${row.id}/void`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason }) }); const data = await response.json();
    if (!response.ok) { showToast(data.error ?? `${label}失败`); return; } showToast(`${label}完成并写入审计日志`); startTransition(() => router.refresh());
  }
  function approvalDone(message: string) { setApproval(null); showToast(message); startTransition(() => router.refresh()); }
  function exportCsv() { const head = definition.columns.map((column) => column.label); const body = filtered.map((row) => definition.columns.map((column) => `"${String(row[column.key] ?? "").replaceAll('"', '""')}"`)); const blob = new Blob(["\ufeff" + [head, ...body].map((line) => line.join(",")).join("\n")], { type: "text/csv;charset=utf-8" }); const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `${definition.title}.csv`; anchor.click(); URL.revokeObjectURL(url); }
  function clickRow(row: Row) { if (detailResources.has(definition.key)) router.push(`/${definition.key}/${row.id}`); }
  const approvalResource = definition.key === "purchase-requests" || definition.key === "payment-requests";
  const hasActions = Boolean(attachmentObjectTypes[definition.key]) || (canWrite && (editableResources.has(definition.key) || voidableResources.has(definition.key))) || (approvalResource && (role === "owner" || (definition.key === "payment-requests" && role === "finance")));
  return <>
    <section className="panel"><div className="toolbar"><div className="search"><Search /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={definition.searchPlaceholder} /></div><div className="heading-actions"><button className="button" onClick={exportCsv}><Download />导出</button>{canWrite && fields.length ? <button className="button primary" onClick={openCreate}><Plus />{definition.createLabel ?? "新增"}</button> : null}</div></div>
      {filtered.length ? <div className="table-scroll"><table className="data-table"><thead><tr>{definition.columns.map((column) => <th className={column.align === "right" ? "right" : ""} key={column.key}>{column.label}</th>)}{hasActions ? <th>操作</th> : null}</tr></thead><tbody>{filtered.map((row) => <tr key={row.id} className={detailResources.has(definition.key) ? "clickable" : ""} onClick={() => clickRow(row)}>{definition.columns.map((column) => <td key={column.key} className={column.align === "right" ? "right" : ""}><Cell value={row[column.key]} column={column} /></td>)}{hasActions ? <td onClick={(event) => event.stopPropagation()}><div className="heading-actions">{attachmentObjectTypes[definition.key] ? <button className="button small" onClick={() => setAttachmentRow(row)}><Paperclip />附件</button> : null}{canWrite && canEditRow(definition.key, row) ? <button className="button small" onClick={() => openEdit(row)}><Pencil />编辑</button> : null}{canWrite && voidableResources.has(definition.key) ? <button className="button small danger" onClick={() => voidRow(row)}><Ban />{definition.key === "payments" ? "冲销" : definition.key === "receipts" ? "撤销" : "作废"}</button> : null}{definition.key === "purchase-requests" && role === "owner" ? <button className="button small primary" onClick={() => setApproval({ type: "purchase", id: row.id })}><Eye />审批详情</button> : null}{definition.key === "payment-requests" && (role === "owner" || role === "finance") ? <button className="button small primary" onClick={() => setApproval({ type: "payment", id: row.id })}><Eye />{role === "finance" && row.status === "已通过" ? "付款详情" : "审批详情"}</button> : null}</div></td> : null}</tr>)}</tbody></table></div> : <div className="empty"><div><FileQuestion /><strong>{definition.emptyTitle}</strong><div style={{ fontSize: 11, marginTop: 5 }}>调整筛选条件或新增第一条记录</div></div></div>}<div className="pagination-info">显示 {filtered.length} 条，共 {rows.length} 条记录</div>
    </section>
    {showForm ? <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowForm(false); }}><form className="modal" onSubmit={submit} key={editingRow?.id ?? "create"}><div className="modal-header"><div className="modal-title">{editingRow ? "编辑" : "新增"}{definition.title}</div><button className="icon-plain" type="button" onClick={() => setShowForm(false)} aria-label="关闭"><X /></button></div><div className="form-grid">{fields.map((field) => <Field key={field.key} field={field} value={fieldValue(field, editingRow)} />)}{error ? <div className="form-error">{error}</div> : null}</div><div className="modal-footer"><button className="button" type="button" onClick={() => setShowForm(false)}>取消</button><button className="button primary" type="submit" disabled={pending}>{pending ? <LoaderCircle className="animate-spin" /> : <Check />}确认保存</button></div></form></div> : null}
    {approval ? <ApprovalDetail {...approval} role={role} onClose={() => setApproval(null)} onDone={approvalDone} /> : null}
    {attachmentRow ? <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setAttachmentRow(null)}><section className="modal attachment-modal"><div className="modal-header"><div className="modal-title">业务附件</div><button className="icon-plain" onClick={() => setAttachmentRow(null)} aria-label="关闭"><X /></button></div><div className="attachment-modal-body"><AttachmentPanel objectType={attachmentObjectTypes[definition.key]} objectId={attachmentRow.id} canUpload={canWrite} title={`${String(attachmentRow.number ?? attachmentRow.code ?? definition.title)} 附件`} /></div></section></div> : null}{toast ? <div className="toast">{toast}</div> : null}
  </>;
}

function Field({ field, value }: { field: FieldDef; value: string | number }) {
  const full = field.type === "textarea" || field.type === "reference";
  return <div className={`field ${full ? "full" : ""}`}><label htmlFor={field.key}>{field.label}{field.required ? <span className="required">*</span> : null}</label>{field.type === "select" || field.type === "reference" ? <select className="input" id={field.key} name={field.key} required={field.required} defaultValue={value}><option value="" disabled>请选择</option>{field.options?.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select> : field.type === "textarea" ? <textarea className="input" id={field.key} name={field.key} required={field.required} placeholder={field.placeholder} defaultValue={value} /> : <input className="input" id={field.key} name={field.key} type={field.type} required={field.required} step={field.type === "number" ? "0.0001" : undefined} placeholder={field.placeholder} defaultValue={value} />}</div>;
}
