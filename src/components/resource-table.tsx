"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Download, FileQuestion, LoaderCircle, Plus, Search, X } from "lucide-react";
import type { ColumnDef, FieldDef, ResourceDefinition } from "@/data/resources";
import { formatDate, formatMoney, formatRatio, getStatusTone } from "@/lib/format";

type Row = Record<string, unknown> & { id: number; status?: string };

function Cell({ value, column }: { value: unknown; column: ColumnDef }) {
  if (column.format === "money") return <span className="money">{formatMoney(Number(value))}</span>;
  if (column.format === "date") return <span>{formatDate(value as string)}</span>;
  if (column.format === "ratio") return <span>{formatRatio(Number(value))}</span>;
  if (column.format === "status") return <span className={`badge ${getStatusTone(String(value ?? ""))}`}>{String(value ?? "-")}</span>;
  if (column.format === "number") return <span>{Number(value ?? 0).toLocaleString("zh-CN")}</span>;
  return <span className={column.key === "name" || column.key === "number" || column.key === "code" ? "table-primary" : ""}>{String(value ?? "-")}</span>;
}

export function ResourceTable({ definition, rows, canWrite, role }: { definition: ResourceDefinition; rows: Row[]; canWrite: boolean; role: string }) {
  const router = useRouter(); const [query, setQuery] = useState(""); const [showForm, setShowForm] = useState(false); const [error, setError] = useState(""); const [toast, setToast] = useState(""); const [pending, startTransition] = useTransition();
  const filtered = useMemo(() => rows.filter((row) => Object.values(row).some((value) => String(value ?? "").toLowerCase().includes(query.toLowerCase()))), [rows, query]);
  const fields = definition.fields ?? [];
  function showToast(message: string) { setToast(message); window.setTimeout(() => setToast(""), 2600); }
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); const formData = new FormData(event.currentTarget); const body = Object.fromEntries(formData.entries());
    const response = await fetch(`/api/resources/${definition.key}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); const data = await response.json();
    if (!response.ok) { setError(data.error ?? "保存失败"); return; }
    setShowForm(false); showToast("已保存并写入操作日志"); startTransition(() => router.refresh());
  }
  async function workflow(id: number, type: "purchase" | "payment", action: "approve" | "reject" | "pay") {
    const message = action === "approve" ? "确认通过这笔申请？" : action === "reject" ? "确认驳回这笔申请？" : "确认已核对回单并执行付款？";
    if (!window.confirm(message)) return;
    const response = await fetch(`/api/workflows/${type}/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(action === "pay" ? { action } : { decision: action, comment: action === "approve" ? "资料已核对" : "资料需补充" }) });
    const data = await response.json(); if (!response.ok) { showToast(data.error ?? "操作失败"); return; } showToast(action === "pay" ? "付款已登记" : "审批已完成"); startTransition(() => router.refresh());
  }
  function exportCsv() {
    const head = definition.columns.map((column) => column.label); const body = filtered.map((row) => definition.columns.map((column) => `"${String(row[column.key] ?? "").replaceAll('"', '""')}"`));
    const blob = new Blob(["\ufeff" + [head, ...body].map((line) => line.join(",")).join("\n")], { type: "text/csv;charset=utf-8" }); const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `${definition.title}.csv`; anchor.click(); URL.revokeObjectURL(url);
  }
  function clickRow(row: Row) { if (definition.key === "projects") router.push(`/projects/${row.id}`); }
  const hasActions = (definition.key === "purchase-requests" && role === "owner") || (definition.key === "payment-requests" && (role === "owner" || role === "finance"));
  return <>
    <section className="panel">
      <div className="toolbar"><div className="search"><Search /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={definition.searchPlaceholder} /></div><div className="heading-actions"><button className="button" onClick={exportCsv}><Download />导出</button>{canWrite && fields.length ? <button className="button primary" onClick={() => setShowForm(true)}><Plus />{definition.createLabel ?? "新增"}</button> : null}</div></div>
      {filtered.length ? <div className="table-scroll"><table className="data-table"><thead><tr>{definition.columns.map((column) => <th className={column.align === "right" ? "right" : ""} key={column.key}>{column.label}</th>)}{hasActions ? <th>操作</th> : null}</tr></thead><tbody>{filtered.map((row) => <tr key={row.id} className={definition.key === "projects" ? "clickable" : ""} onClick={() => clickRow(row)}>{definition.columns.map((column) => <td key={column.key} className={column.align === "right" ? "right" : ""}><Cell value={row[column.key]} column={column} /></td>)}{hasActions ? <td onClick={(event) => event.stopPropagation()}>{definition.key === "purchase-requests" && row.status === "待审批" ? <div className="heading-actions"><button className="button small primary" disabled={pending} onClick={() => workflow(row.id, "purchase", "approve")}><Check />通过</button><button className="button small danger" disabled={pending} onClick={() => workflow(row.id, "purchase", "reject")}><X />驳回</button></div> : definition.key === "payment-requests" && row.status === "待审批" && role === "owner" ? <div className="heading-actions"><button className="button small primary" disabled={pending} onClick={() => workflow(row.id, "payment", "approve")}><Check />通过</button><button className="button small danger" disabled={pending} onClick={() => workflow(row.id, "payment", "reject")}><X />驳回</button></div> : definition.key === "payment-requests" && row.status === "已通过" ? <button className="button small primary" disabled={pending} onClick={() => workflow(row.id, "payment", "pay")}><Check />登记付款</button> : <span style={{ color: "var(--muted)" }}>-</span>}</td> : null}</tr>)}</tbody></table></div> : <div className="empty"><div><FileQuestion /><strong>{definition.emptyTitle}</strong><div style={{ fontSize: 11, marginTop: 5 }}>调整筛选条件或新增第一条记录</div></div></div>}
      <div className="pagination-info">显示 {filtered.length} 条，共 {rows.length} 条记录</div>
    </section>
    {showForm ? <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowForm(false); }}><form className="modal" onSubmit={submit}><div className="modal-header"><div className="modal-title">新增{definition.title}</div><button className="icon-plain" type="button" onClick={() => setShowForm(false)} aria-label="关闭"><X /></button></div><div className="form-grid">{fields.map((field) => <Field key={field.key} field={field} />)}{error ? <div className="form-error">{error}</div> : null}</div><div className="modal-footer"><button className="button" type="button" onClick={() => setShowForm(false)}>取消</button><button className="button primary" type="submit" disabled={pending}>{pending ? <LoaderCircle className="animate-spin" /> : <Check />}确认保存</button></div></form></div> : null}
    {toast ? <div className="toast">{toast}</div> : null}
  </>;
}

function Field({ field }: { field: FieldDef }) {
  const full = field.type === "textarea" || field.type === "reference";
  return <div className={`field ${full ? "full" : ""}`}><label htmlFor={field.key}>{field.label}{field.required ? <span className="required">*</span> : null}</label>{field.type === "select" || field.type === "reference" ? <select className="input" id={field.key} name={field.key} required={field.required} defaultValue=""><option value="" disabled>请选择</option>{field.options?.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select> : field.type === "textarea" ? <textarea className="input" id={field.key} name={field.key} required={field.required} placeholder={field.placeholder} /> : <input className="input" id={field.key} name={field.key} type={field.type} required={field.required} step={field.type === "number" ? "0.01" : undefined} placeholder={field.placeholder} />}</div>;
}
