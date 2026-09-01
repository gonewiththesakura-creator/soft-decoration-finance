"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowLeft, ArrowRight, CheckCircle2, Database, Download, FileSpreadsheet, History, LoaderCircle, RotateCcw, Save, Upload } from "lucide-react";
import { migrationDefinition, migrationDefinitions, suggestFieldMappings, type MigrationIssue } from "@/data/data-migration-rules";
import { ExcelImporter } from "./excel-importer";

type SheetInfo = { id: number; name: string; rowCount: number; columnCount: number; headers: string[]; previewRows: Record<string, unknown>[]; matchedTemplate?: { id: number; name: string; businessType: string; mappings: Record<string, string> } | null };
type Workbook = { batchId: number; batchNumber: string; filename: string; fileSize: number; sheetCount: number; duplicateOf: string | null; sheets: SheetInfo[] };
type StagingRow = { id: number; sourceRow: number; normalizedData: Record<string, unknown>; issues: MigrationIssue[]; duplicateStatus: string; duplicateTargetId: number | null; action: string; status: string; targetTable?: string; targetId?: number };
type Resolution = { stagingRowId: number; fieldKey: string; entityType: string; inputValue: string; status: string; candidates: { id: number; name: string; code: string }[] };
type BatchDetail = { batch: Record<string, unknown>; file: Record<string, unknown>; sheets: SheetInfo[]; rows: StagingRow[]; resolutions: Resolution[]; unresolvedReferences: number; page: number; pageSize: number };
type Overview = { summary: Record<string, number>; batches: Record<string, unknown>[] };

const migrationOrder = ["公司 / 账户", "客户 / 供应商", "项目", "合同", "预算 / SKU", "应收", "报价 / 采购", "应付", "收款", "付款", "发票", "库存 / 退换货"];
const statusLabels: Record<string, string> = { UPLOADED: "已上传", VALIDATED: "预检完成", READY_TO_IMPORT: "待正式导入", COMPLETED: "已完成", ROLLED_BACK: "已撤销", READY: "可导入", WARNING: "需确认", ERROR: "错误", CONFIRMED: "已确认", IMPORTED: "已导入", SKIPPED: "已跳过" };
const businessLabels = Object.fromEntries(migrationDefinitions.map((item) => [item.resource, item.label]));
const batchValue = (batch: Record<string, unknown>, camel: string, snake: string) => batch[camel] ?? batch[snake];

export function DataMigrationCenter({ allowedTypes }: { allowedTypes: string[] }) {
  const [mode, setMode] = useState<"standard" | "history">("history"); const [workbook, setWorkbook] = useState<Workbook | null>(null);
  const [selectedSheet, setSelectedSheet] = useState<SheetInfo | null>(null); const [businessType, setBusinessType] = useState(allowedTypes[0] ?? "customers");
  const [mappings, setMappings] = useState<Record<string, string>>({}); const [templateName, setTemplateName] = useState(""); const [detail, setDetail] = useState<BatchDetail | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null); const [loading, setLoading] = useState(false); const [message, setMessage] = useState(""); const [editRow, setEditRow] = useState<StagingRow | null>(null);
  const inputRef = useRef<HTMLInputElement>(null); const definition = migrationDefinition(businessType);

  async function readJson(response: Response) { const data = await response.json(); if (!response.ok) throw new Error(data.error ?? "操作失败"); return data; }
  async function refreshOverview() { const response = await fetch("/api/migrations/batches"); if (response.ok) setOverview(await response.json()); }
  async function loadBatch(batchId: number, page = 1) { setLoading(true); try { setDetail(await readJson(await fetch(`/api/migrations/batches/${batchId}?page=${page}`))); } catch (error) { setMessage(error instanceof Error ? error.message : "读取批次失败"); } finally { setLoading(false); } }
  useEffect(() => { void refreshOverview(); }, []);
  useEffect(() => {
    if (!selectedSheet) return;
    const matched = selectedSheet.matchedTemplate;
    if (matched?.businessType === businessType) { setMappings(matched.mappings); setTemplateName(matched.name); }
    else { setMappings(suggestFieldMappings(businessType, selectedSheet.headers)); setTemplateName(""); }
  }, [businessType, selectedSheet]);

  async function upload(file?: File) {
    if (!file) return; setLoading(true); setMessage("解析工作簿与 Sheet 中..."); setDetail(null);
    try { const form = new FormData(); form.set("file", file); const data = await readJson(await fetch("/api/migrations/workbook", { method: "POST", body: form })) as Workbook; setWorkbook(data); setSelectedSheet(data.sheets[0] ?? null); setMessage(`工作簿解析完成：${data.sheetCount} 个 Sheet`); }
    catch (error) { setMessage(error instanceof Error ? error.message : "上传失败"); } finally { setLoading(false); if (inputRef.current) inputRef.current.value = ""; }
  }
  async function stage() {
    if (!workbook || !selectedSheet) return; setLoading(true); setMessage("关联匹配、标准化、重复检测与业务校验中...");
    try {
      const result = await readJson(await fetch("/api/migrations/stage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ batchId: workbook.batchId, sheetId: selectedSheet.id, businessType, mappings, saveTemplateName: templateName.trim() || undefined }) }));
      setMessage(`预检完成：${result.ready} 行可导入，${result.warning} 行需确认，${result.error} 行错误`); await loadBatch(workbook.batchId); await refreshOverview();
    } catch (error) { setMessage(error instanceof Error ? error.message : "预检失败"); } finally { setLoading(false); }
  }
  async function batchAction(action: "confirm" | "import" | "rollback") {
    if (!detail) return; const batchId = Number(detail.batch.id); setLoading(true); setMessage(action === "import" ? "正式数据原子写入中..." : action === "rollback" ? "检查下游引用并撤销中..." : "确认暂存数据中...");
    try { const result = await readJson(await fetch(`/api/migrations/batches/${batchId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) })); if (action === "rollback" && result.ok === false) throw new Error(`无法自动撤销：${result.blocked.slice(0, 3).join("；")}`); setMessage(action === "confirm" ? "人工确认完成，可以正式导入" : action === "import" ? "批次已原子写入并保存数据血缘" : "批次已安全撤销"); await loadBatch(batchId); await refreshOverview(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "批次操作失败"); } finally { setLoading(false); }
  }
  async function updateRow(rowId: number, payload: Record<string, unknown>) {
    if (!detail) return; const batchId = Number(detail.batch.id); setLoading(true);
    try { await readJson(await fetch(`/api/migrations/batches/${batchId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operation: "update-row", rowId, ...payload }) })); await loadBatch(batchId, detail.page); setEditRow(null); setMessage("暂存行已更新并完成复检"); }
    catch (error) { setMessage(error instanceof Error ? error.message : "暂存行修改失败"); } finally { setLoading(false); }
  }
  const fields = definition?.fields ?? []; const batchStatus = detail ? String(detail.batch.status) : "";
  const errorRows = detail ? Number(batchValue(detail.batch, "errorRows", "error_rows") ?? 0) : 0;
  const resolutionsByRow = useMemo(() => new Map((detail?.resolutions ?? []).map((resolution) => [resolution.stagingRowId, [...((detail?.resolutions ?? []).filter((item) => item.stagingRowId === resolution.stagingRowId))]])), [detail]);

  return <>
    <div className="migration-mode" role="tablist" aria-label="导入模式">
      <button className={mode === "standard" ? "active" : ""} onClick={() => setMode("standard")}><FileSpreadsheet />日常标准导入</button>
      <button className={mode === "history" ? "active" : ""} onClick={() => setMode("history")}><Database />历史 Excel 迁移</button>
    </div>
    {mode === "standard" ? <ExcelImporter /> : <div className="migration-stack">
      <section className="migration-overview">
        <div className="panel migration-guide"><div className="panel-header"><div><div className="panel-title">推荐迁移顺序</div><div className="panel-subtitle">按业务依赖从主数据到财务事实</div></div></div><div className="migration-order">{migrationOrder.map((item, index) => <div key={item}><span>{String(index + 1).padStart(2, "0")}</span><strong>{item}</strong></div>)}</div></div>
        <div className="panel"><div className="panel-header"><div><div className="panel-title">当前数据基线</div><div className="panel-subtitle">正式库实时统计</div></div></div><div className="migration-baseline">{[["项目", overview?.summary.projects], ["供应商", overview?.summary.suppliers], ["SKU", overview?.summary.skus], ["采购", overview?.summary.purchases], ["付款", overview?.summary.payments]].map(([label, value]) => <div key={String(label)}><span>{label}</span><strong>{Number(value ?? 0).toLocaleString("zh-CN")}</strong></div>)}</div></div>
      </section>

      <section className="panel">
        <div className="panel-header"><div><div className="panel-title">1. 上传原始工作簿</div><div className="panel-subtitle">支持多 Sheet，单个 Sheet 最多 10,000 行</div></div>{workbook ? <span className="badge success">{workbook.batchNumber}</span> : null}</div>
        <div className="migration-upload"><input ref={inputRef} type="file" accept=".xlsx,.xls" onChange={(event) => void upload(event.target.files?.[0])} /><button className="button primary" onClick={() => inputRef.current?.click()} disabled={loading}>{loading ? <LoaderCircle className="animate-spin" /> : <Upload />}选择原始 Excel</button>{workbook ? <div><strong>{workbook.filename}</strong><span>{(workbook.fileSize / 1024).toFixed(1)} KB · {workbook.sheetCount} 个 Sheet</span></div> : <span>文件只进入迁移暂存区，不会直接写入正式业务表</span>}</div>
        {workbook?.duplicateOf ? <div className="migration-notice warning"><AlertTriangle />文件内容与已完成批次 {workbook.duplicateOf} 相同，请核实后再继续。</div> : null}
      </section>

      {workbook ? <section className="panel"><div className="panel-header"><div><div className="panel-title">2. 选择 Sheet</div><div className="panel-subtitle">查看规模、表头和前 10 行</div></div></div><div className="sheet-selector">{workbook.sheets.map((sheet) => <button key={sheet.id} className={selectedSheet?.id === sheet.id ? "active" : ""} onClick={() => setSelectedSheet(sheet)}><div><FileSpreadsheet /><strong>{sheet.name}</strong></div><span>{sheet.rowCount.toLocaleString("zh-CN")} 行 · {sheet.columnCount} 列</span>{sheet.matchedTemplate ? <small>已识别：{sheet.matchedTemplate.name}</small> : <small>等待业务类型与字段映射</small>}</button>)}</div>{selectedSheet ? <div className="table-scroll"><table className="data-table migration-preview"><thead><tr>{selectedSheet.headers.map((header) => <th key={header}>{header}</th>)}</tr></thead><tbody>{selectedSheet.previewRows.map((row, index) => <tr key={index}>{selectedSheet.headers.map((header) => <td key={header}>{String(row[header] ?? "-")}</td>)}</tr>)}</tbody></table></div> : null}</section> : null}

      {selectedSheet ? <section className="panel"><div className="panel-header"><div><div className="panel-title">3. 业务类型与字段映射</div><div className="panel-subtitle">精确表头与别名字典已自动建议，未识别字段保持忽略</div></div><span className="badge">规则匹配</span></div><div className="mapping-toolbar"><div className="field"><label>业务类型</label><select className="input" value={businessType} onChange={(event) => setBusinessType(event.target.value)}>{migrationDefinitions.filter((item) => allowedTypes.includes(item.resource)).map((item) => <option key={item.resource} value={item.resource}>{item.label}</option>)}</select></div><div className="field"><label>保存 Mapping Template（可选）</label><input className="input" value={templateName} onChange={(event) => setTemplateName(event.target.value)} placeholder="例如：2024-2026 项目采购总表格式" /></div></div><div className="table-scroll"><table className="data-table mapping-table"><thead><tr><th>Excel 字段</th><th>系统字段</th><th>匹配结果</th></tr></thead><tbody>{selectedSheet.headers.map((header) => <tr key={header}><td className="table-primary">{header}</td><td><select className="input" value={mappings[header] ?? ""} onChange={(event) => setMappings((current) => ({ ...current, [header]: event.target.value }))}><option value="">忽略此列</option>{fields.map((field) => <option key={field.key} value={field.key}>{field.displayLabel}{field.required ? " *" : ""}</option>)}</select></td><td><span className={`badge ${mappings[header] ? "success" : ""}`}>{mappings[header] ? "已映射" : "忽略"}</span></td></tr>)}</tbody></table></div><div className="modal-footer"><button className="button primary" onClick={() => void stage()} disabled={loading}>{loading ? <LoaderCircle className="animate-spin" /> : <CheckCircle2 />}进入暂存区预检</button></div></section> : null}

      {message ? <div className="migration-notice"><CheckCircle2 />{message}</div> : null}
      {detail && detail.rows.length ? <section className="panel"><div className="panel-header"><div><div className="panel-title">4. 暂存区预览与人工确认</div><div className="panel-subtitle">第 {detail.page} 页，每页 {detail.pageSize} 行</div></div><div className="migration-counts"><span className="badge success">可导入 {String(batchValue(detail.batch, "readyRows", "ready_rows") ?? 0)}</span><span className="badge warning">警告 {String(batchValue(detail.batch, "warningRows", "warning_rows") ?? 0)}</span><span className="badge danger">错误 {String(batchValue(detail.batch, "errorRows", "error_rows") ?? 0)}</span>{detail.unresolvedReferences > 0 ? <span className="badge warning">待确认关联 {detail.unresolvedReferences}</span> : null}{errorRows > 0 ? <a className="button small" href={`/api/migrations/batches/${String(detail.batch.id)}/errors`}><Download />导出错误行</a> : null}</div></div><div className="table-scroll"><table className="data-table staging-table"><thead><tr><th>原始行</th><th>标准化数据</th><th>关联 / 重复</th><th>状态</th><th>处理</th></tr></thead><tbody>{detail.rows.map((row) => <tr key={row.id}><td>{row.sourceRow}</td><td><div className="staging-values">{fields.slice(0, 4).map((field) => <span key={field.key}><small>{field.displayLabel}</small>{String(row.normalizedData[field.key] ?? "-")}</span>)}</div></td><td><div className="issue-list">{row.issues.length ? row.issues.slice(0, 3).map((issue, index) => <span className={issue.severity === "ERROR" ? "danger-text" : "warning-text"} key={`${issue.code}-${index}`}>{issue.message}</span>) : <span className="success-text">校验通过</span>}{(resolutionsByRow.get(row.id) ?? []).map((resolution) => resolution.candidates.length ? <select key={resolution.fieldKey} className="input compact" defaultValue="" onChange={(event) => event.target.value && void updateRow(row.id, { fieldKey: resolution.fieldKey, confirmedReferenceId: Number(event.target.value) })}><option value="">选择{resolution.inputValue}的匹配项</option>{resolution.candidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.code} · {candidate.name}</option>)}</select> : null)}</div></td><td><span className={`badge ${row.status === "ERROR" ? "danger" : row.status === "WARNING" ? "warning" : "success"}`}>{statusLabels[row.status] ?? row.status}</span></td><td><div className="row-actions"><button className="button small" onClick={() => setEditRow(row)}>编辑</button>{(row.duplicateStatus !== "NEW" || row.status === "ERROR") ? <select className="input compact" value={row.action} onChange={(event) => void updateRow(row.id, { action: event.target.value })}><option value="SKIP">跳过</option><option value="MATCH">匹配现有</option><option value="CREATE">作为新记录</option></select> : null}</div></td></tr>)}</tbody></table></div><div className="migration-footer"><div><button className="button small" disabled={detail.page <= 1 || loading} onClick={() => void loadBatch(Number(detail.batch.id), detail.page - 1)}><ArrowLeft />上一页</button><button className="button small" disabled={detail.rows.length < detail.pageSize || loading} onClick={() => void loadBatch(Number(detail.batch.id), detail.page + 1)}>下一页<ArrowRight /></button></div><div>{batchStatus === "VALIDATED" ? <button className="button" disabled={errorRows > 0 || detail.unresolvedReferences > 0 || loading} onClick={() => void batchAction("confirm")}><CheckCircle2 />人工确认</button> : null}{batchStatus === "READY_TO_IMPORT" ? <button className="button primary" disabled={loading} onClick={() => void batchAction("import")}><Database />正式导入</button> : null}{batchStatus === "COMPLETED" ? <button className="button danger" disabled={loading} onClick={() => void batchAction("rollback")}><RotateCcw />撤销批次</button> : null}</div></div></section> : null}

      <section className="panel"><div className="panel-header"><div><div className="panel-title">导入历史</div><div className="panel-subtitle">批次、来源、Mapping、Hash 状态与结果统计</div></div><History /></div><div className="table-scroll"><table className="data-table"><thead><tr><th>批次</th><th>来源</th><th>业务类型</th><th>Mapping</th><th>总行数</th><th>结果</th><th>状态</th><th></th></tr></thead><tbody>{overview?.batches.map((batch) => <tr key={String(batch.id)}><td className="table-primary">{String(batch.batchNumber)}<div className="table-secondary">Hash {String(batch.sourceHash ?? "").slice(0, 10)}</div></td><td>{String(batch.filename ?? "-")}<div className="table-secondary">{String(batch.sheetName ?? "未选择 Sheet")}</div></td><td>{businessLabels[String(batch.businessType)] ?? String(batch.businessType ?? "-")}</td><td>{String(batch.mappingName ?? "临时映射")}</td><td>{String(batch.totalRows)}</td><td><span className="success-text">{String(batch.successRows)}</span> / <span className="warning-text">{String(batch.skippedRows)}</span> / <span className="danger-text">{String(batch.errorRows)}</span></td><td><span className={`badge ${batch.status === "COMPLETED" ? "success" : batch.status === "ROLLED_BACK" ? "danger" : "warning"}`}>{statusLabels[String(batch.status)] ?? String(batch.status)}</span></td><td><button className="button small" onClick={() => void loadBatch(Number(batch.id))}>查看</button></td></tr>)}</tbody></table></div></section>
    </div>}
    {editRow ? <EditStagingModal row={editRow} fields={fields.filter((field) => !field.reference)} onClose={() => setEditRow(null)} onSave={(updates) => void updateRow(editRow.id, { updates })} /> : null}
  </>;
}

function EditStagingModal({ row, fields, onClose, onSave }: { row: StagingRow; fields: NonNullable<ReturnType<typeof migrationDefinition>>["fields"]; onClose: () => void; onSave: (updates: Record<string, unknown>) => void }) {
  const [values, setValues] = useState<Record<string, unknown>>(() => Object.fromEntries(fields.map((field) => [field.key, row.normalizedData[field.key] ?? ""])));
  return <div className="modal-backdrop"><div className="modal"><div className="modal-header"><div className="modal-title">修改暂存数据 · 原始行 {row.sourceRow}</div><button className="icon-plain" onClick={onClose}>×</button></div><div className="form-grid">{fields.map((field) => <div className="field" key={field.key}><label>{field.displayLabel}{field.required ? <span className="required">*</span> : null}</label><input className="input" type={field.type === "number" ? "number" : field.type === "date" ? "date" : "text"} value={String(values[field.key] ?? "")} onChange={(event) => setValues((current) => ({ ...current, [field.key]: field.type === "number" ? Number(event.target.value) : event.target.value }))} /></div>)}</div><div className="modal-footer"><button className="button" onClick={onClose}>取消</button><button className="button primary" onClick={() => onSave(values)}><Save />保存并复检</button></div></div></div>;
}



