"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowLeft, ArrowRight, CheckCircle2, Database, Download, FileSpreadsheet, FolderOpen, History, LoaderCircle, RotateCcw, Save, Search, Upload } from "lucide-react";
import { migrationDefinition, migrationDefinitions, suggestFieldMappings, type MigrationIssue } from "@/data/data-migration-rules";

type SheetInfo = { id: number; name: string; rowCount: number; columnCount: number; headers: string[]; previewRows: Record<string, unknown>[]; classification?: string; classificationConfidence?: number; classificationWarnings?: string[]; learnedMappings?: Record<string, Record<string, string>>; matchedTemplate?: { id: number; name: string; businessType: string; mappings: Record<string, string> } | null };
type Workbook = { batchId: number; batchNumber: string; filename: string; fileSize: number; sheetCount: number; fingerprintStatus?: string; versionNumber?: number; sourceGroupKey?: string; duplicateOf: string | null; sheets: SheetInfo[] };
type StagingRow = { id: number; sourceRow: number; normalizedData: Record<string, unknown>; issues: MigrationIssue[]; duplicateStatus: string; duplicateTargetId: number | null; action: string; status: string; targetTable?: string; targetId?: number };
type Resolution = { stagingRowId: number; fieldKey: string; entityType: string; inputValue: string; status: string; candidates: { id: number; name: string; code: string }[] };
type BatchDetail = { batch: Record<string, unknown>; file: Record<string, unknown>; sheets: SheetInfo[]; rows: StagingRow[]; resolutions: Resolution[]; unresolvedReferences: number; page: number; pageSize: number };
type Overview = { summary: Record<string, number>; batches: Record<string, unknown>[] };
type ScannedFile = { path: string; filename: string; extension: string; size: number; modifiedAt: string; hash: string | null; status: string; previousBatchNumber: string | null; error: string | null };

const migrationOrder = ["公司 / 账户", "客户 / 供应商", "项目", "合同", "预算 / SKU", "应收", "报价 / 采购", "应付", "收款", "付款", "发票", "库存 / 退换货"];
const statusLabels: Record<string, string> = { UPLOADED: "已上传", VALIDATED: "预检完成", READY_TO_IMPORT: "待正式导入", COMPLETED: "已完成", ROLLED_BACK: "已撤销", READY: "可导入", WARNING: "需确认", ERROR: "错误", CONFIRMED: "已确认", IMPORTED: "已导入", SKIPPED: "已跳过" };
const fingerprintLabels: Record<string, string> = { NEW: "新文件", UPDATED: "新版本", UNCHANGED: "未变化", DUPLICATE: "重复文件", UNSUPPORTED: "不支持", ERROR: "读取错误" };
const sourceChannelLabels: Record<string, string> = { UPLOAD_UI: "网页上传", FOLDER: "服务器文件夹", EXTERNAL_API: "外部 API" };
const classificationLabels: Record<string, string> = { PROJECT_SUMMARY: "项目汇总", CONTRACT: "合同", PROJECT_COST: "项目成本", SKU_DETAIL: "SKU 明细", SUPPLIER_QUOTE: "供应商报价", PURCHASE_ORDER: "采购订单", PAYABLE: "应付", PAYMENT: "付款", RECEIVABLE: "应收", RECEIPT: "收款", INVOICE: "发票", REFERENCE: "基础资料", EMPTY: "空 Sheet", UNKNOWN: "待识别" };
const classificationResources: Record<string, string> = { PROJECT_SUMMARY: "projects", CONTRACT: "contracts", PROJECT_COST: "skus", SKU_DETAIL: "skus", SUPPLIER_QUOTE: "quotes", PURCHASE_ORDER: "purchase-requests", PAYABLE: "payables", PAYMENT: "payments", RECEIVABLE: "receivables", RECEIPT: "receipts", INVOICE: "invoices" };
const businessLabels = Object.fromEntries(migrationDefinitions.map((item) => [item.resource, item.label]));
const batchValue = (batch: Record<string, unknown>, camel: string, snake: string) => batch[camel] ?? batch[snake];

export function DataMigrationCenter({ allowedTypes, dataMode, initialMode, isOwner }: { allowedTypes: string[]; dataMode: "real" | "demo"; initialMode: "upload" | "folder"; isOwner: boolean }) {
  const [mode, setMode] = useState<"upload" | "folder">(initialMode); const [workbook, setWorkbook] = useState<Workbook | null>(null);
  const [selectedSheet, setSelectedSheet] = useState<SheetInfo | null>(null); const [businessType, setBusinessType] = useState(allowedTypes[0] ?? "customers");
  const [mappings, setMappings] = useState<Record<string, string>>({}); const [templateName, setTemplateName] = useState(""); const [detail, setDetail] = useState<BatchDetail | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null); const [loading, setLoading] = useState(false); const [message, setMessage] = useState(""); const [editRow, setEditRow] = useState<StagingRow | null>(null);
  const [folderPath, setFolderPath] = useState(""); const [recursive, setRecursive] = useState(false); const [scanFiles, setScanFiles] = useState<ScannedFile[]>([]); const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null); const definition = migrationDefinition(businessType);

  async function readJson(response: Response) { const data = await response.json(); if (!response.ok) throw new Error(data.error ?? "操作失败"); return data; }
  async function refreshOverview() { const response = await fetch("/api/migrations/batches"); if (response.ok) setOverview(await response.json()); }
  async function loadBatch(batchId: number, page = 1) { setLoading(true); try { setDetail(await readJson(await fetch(`/api/migrations/batches/${batchId}?page=${page}`))); } catch (error) { setMessage(error instanceof Error ? error.message : "读取批次失败"); } finally { setLoading(false); } }
  useEffect(() => { void refreshOverview(); }, []);
  useEffect(() => {
    if (!selectedSheet) return;
    const matched = selectedSheet.matchedTemplate;
    if (matched?.businessType === businessType) { setMappings(matched.mappings); setTemplateName(matched.name); }
    else { setMappings({ ...suggestFieldMappings(businessType, selectedSheet.headers), ...(selectedSheet.learnedMappings?.[businessType] ?? {}) }); setTemplateName(""); }
  }, [businessType, selectedSheet]);

  function selectWorkbook(data: Workbook) {
    const firstSheet = data.sheets.find((sheet) => !["EMPTY", "UNKNOWN", "REFERENCE"].includes(sheet.classification ?? "UNKNOWN")) ?? data.sheets.find((sheet) => sheet.classification !== "EMPTY") ?? data.sheets[0] ?? null;
    setWorkbook(data); setSelectedSheet(firstSheet); setDetail(null);
    const suggestedResource = firstSheet?.classification ? classificationResources[firstSheet.classification] : undefined;
    if (suggestedResource && allowedTypes.includes(suggestedResource)) setBusinessType(suggestedResource);
  }
  async function upload(files?: FileList | File[]) {
    const selected = files ? Array.from(files).slice(0, 20) : [];
    if (!selected.length) return; setLoading(true); setMessage(`正在暂存 ${selected.length} 个文件...`); setDetail(null);
    try {
      let latest: Workbook | null = null;
      for (const file of selected) { const form = new FormData(); form.set("file", file); latest = await readJson(await fetch("/api/migrations/workbook", { method: "POST", body: form })) as Workbook; }
      if (latest) selectWorkbook(latest);
      setMessage(`${selected.length} 个文件已分别进入暂存批次；当前显示最后一个文件`); await refreshOverview();
    }
    catch (error) { setMessage(error instanceof Error ? error.message : "上传失败"); } finally { setLoading(false); if (inputRef.current) inputRef.current.value = ""; }
  }
  async function scanFolder() {
    setLoading(true); setMessage("正在只读扫描允许目录..."); setScanFiles([]);
    try { const result = await readJson(await fetch("/api/imports/scan-folder", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ folderPath, recursive }) })); setScanFiles(result.files); setMessage(`扫描完成：发现 ${result.files.length} 个文件`); }
    catch (error) { setMessage(error instanceof Error ? error.message : "扫描失败"); } finally { setLoading(false); }
  }
  async function stageFolderFile(path: string) {
    setLoading(true); setMessage("正在复制原文件并创建暂存批次...");
    try { const data = await readJson(await fetch("/api/imports/stage-file", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path }) })) as Workbook; selectWorkbook(data); setMessage(`文件已进入暂存区：${data.batchNumber}`); await refreshOverview(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "暂存失败"); } finally { setLoading(false); }
  }
  async function stage() {
    if (!workbook || !selectedSheet) return; setLoading(true); setMessage("关联匹配、标准化、重复检测与业务校验中...");
    try {
      const result = await readJson(await fetch("/api/migrations/stage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ batchId: workbook.batchId, sheetId: selectedSheet.id, businessType, mappings, saveTemplateName: templateName.trim() || undefined }) }));
      setMessage(`预检完成：${result.ready} 行可导入，${result.warning} 行需确认，${result.error} 行错误`); await loadBatch(workbook.batchId); await refreshOverview();
    } catch (error) { setMessage(error instanceof Error ? error.message : "预检失败"); } finally { setLoading(false); }
  }
  async function batchAction(action: "confirm" | "import" | "rollback") {
    if (!detail) return; const batchId = Number(detail.batch.id); let confirmation = "";
    if (action === "confirm" && dataMode === "real") { confirmation = window.prompt("输入“确认导入真实数据”以锁定当前预检结果") ?? ""; if (confirmation !== "确认导入真实数据") { setMessage("确认短语不匹配，未改变任何数据"); return; } }
    setLoading(true); setMessage(action === "import" ? "正式数据原子写入中..." : action === "rollback" ? "检查下游引用并撤销中..." : "确认暂存数据中...");
    try { const result = await readJson(await fetch(`/api/migrations/batches/${batchId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, confirmation }) })); if (action === "rollback" && result.ok === false) throw new Error(`无法自动撤销：${result.blocked.slice(0, 3).join("；")}`); setMessage(action === "confirm" ? "人工确认完成，可以正式导入" : action === "import" ? "批次已原子写入并保存数据血缘" : "批次已安全撤销"); await loadBatch(batchId); await refreshOverview(); }
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
    <div className="migration-mode" role="tablist" aria-label="数据来源">
      <button className={mode === "upload" ? "active" : ""} onClick={() => setMode("upload")}><Upload />上传文件</button>
      <button className={mode === "folder" ? "active" : ""} onClick={() => setMode("folder")}><FolderOpen />扫描文件夹</button>
    </div>
    <div className="migration-stack">
      <section className="migration-overview">
        <div className="panel migration-guide"><div className="panel-header"><div><div className="panel-title">推荐迁移顺序</div><div className="panel-subtitle">按业务依赖从主数据到财务事实</div></div></div><div className="migration-order">{migrationOrder.map((item, index) => <div key={item}><span>{String(index + 1).padStart(2, "0")}</span><strong>{item}</strong></div>)}</div></div>
        <div className="panel"><div className="panel-header"><div><div className="panel-title">当前数据基线</div><div className="panel-subtitle">正式库实时统计</div></div></div><div className="migration-baseline">{[["项目", overview?.summary.projects], ["供应商", overview?.summary.suppliers], ["SKU", overview?.summary.skus], ["采购", overview?.summary.purchases], ["付款", overview?.summary.payments]].map(([label, value]) => <div key={String(label)}><span>{label}</span><strong>{Number(value ?? 0).toLocaleString("zh-CN")}</strong></div>)}</div></div>
      </section>

      {mode === "upload" ? <section className="panel">
        <div className="panel-header"><div><div className="panel-title">1. 上传原始文件</div><div className="panel-subtitle">支持多选或拖入 .xlsx / .xls / .csv；每个文件建立独立暂存批次</div></div>{workbook ? <span className="badge success">{workbook.batchNumber}</span> : null}</div>
        <div className={`migration-upload ${dragging ? "is-dragging" : ""}`} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); void upload(event.dataTransfer.files); }}><input ref={inputRef} type="file" accept=".xlsx,.xls,.csv" multiple onChange={(event) => void upload(event.target.files ?? undefined)} /><button className="button primary" onClick={() => inputRef.current?.click()} disabled={loading}>{loading ? <LoaderCircle className="animate-spin" /> : <Upload />}选择文件</button>{workbook ? <div><strong>{workbook.filename}</strong><span>{(workbook.fileSize / 1024).toFixed(1)} KB · {workbook.sheetCount} 个 Sheet · V{workbook.versionNumber ?? 1} · {fingerprintLabels[workbook.fingerprintStatus ?? "NEW"]}</span></div> : <span>文件只进入迁移暂存区，不会直接写入正式业务表</span>}</div>
        {workbook?.duplicateOf ? <div className="migration-notice warning"><AlertTriangle />{fingerprintLabels[workbook.fingerprintStatus ?? "DUPLICATE"]}，关联历史批次 {workbook.duplicateOf}，请核实后再继续。</div> : null}
      </section> : <section className="panel">
        <div className="panel-header"><div><div className="panel-title">1. 扫描服务器文件夹</div><div className="panel-subtitle">只读访问允许目录；扫描本身不会复制、移动或写入业务数据</div></div></div>
        {isOwner ? <><div className="folder-scan-toolbar"><div className="field"><label>服务器文件夹路径</label><input className="input" value={folderPath} onChange={(event) => setFolderPath(event.target.value)} placeholder="请输入 IMPORT_ALLOWED_ROOTS 内的目录" /></div><label className="folder-scan-check"><input type="checkbox" checked={recursive} onChange={(event) => setRecursive(event.target.checked)} />包含子文件夹</label><button className="button primary" disabled={loading || !folderPath.trim()} onClick={() => void scanFolder()}>{loading ? <LoaderCircle className="animate-spin" /> : <Search />}开始扫描</button></div>{scanFiles.length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>文件</th><th>修改时间</th><th>大小</th><th>指纹状态</th><th></th></tr></thead><tbody>{scanFiles.map((file) => <tr key={file.path}><td className="table-primary">{file.filename}<div className="table-secondary">{file.path}</div></td><td>{file.modifiedAt ? new Date(file.modifiedAt).toLocaleString("zh-CN") : "-"}</td><td>{file.size ? `${(file.size / 1024).toFixed(1)} KB` : "-"}</td><td><span className={`badge ${file.status === "NEW" || file.status === "UPDATED" ? "success" : file.status === "ERROR" || file.status === "UNSUPPORTED" ? "danger" : "warning"}`}>{fingerprintLabels[file.status] ?? file.status}</span>{file.error ? <div className="table-secondary danger-text">{file.error}</div> : null}</td><td><button className="button small" disabled={loading || !["NEW", "UPDATED", "DUPLICATE", "UNCHANGED"].includes(file.status)} onClick={() => void stageFolderFile(file.path)}>进入暂存区</button></td></tr>)}</tbody></table></div> : null}</> : <div className="migration-notice warning"><AlertTriangle />服务器文件夹扫描仅对老板账号开放。</div>}
      </section>}

      {workbook ? <section className="panel"><div className="panel-header"><div><div className="panel-title">2. 选择 Sheet</div><div className="panel-subtitle">查看结构识别、表头和前 50 行，空 Sheet 会保留但不会作为导入源</div></div></div><div className="sheet-selector">{workbook.sheets.map((sheet) => <button key={sheet.id} className={selectedSheet?.id === sheet.id ? "active" : ""} onClick={() => { setSelectedSheet(sheet); const resource = classificationResources[sheet.classification ?? ""]; if (resource && allowedTypes.includes(resource)) setBusinessType(resource); }}><div><FileSpreadsheet /><strong>{sheet.name}</strong></div><span>{sheet.rowCount.toLocaleString("zh-CN")} 行 · {sheet.columnCount} 列</span><small>{classificationLabels[sheet.classification ?? "UNKNOWN"] ?? sheet.classification} · {Math.round(Number(sheet.classificationConfidence ?? 0) / 100)}%</small>{sheet.matchedTemplate ? <small>Mapping：{sheet.matchedTemplate.name}</small> : null}</button>)}</div>{selectedSheet?.classificationWarnings?.length ? <div className="migration-notice warning"><AlertTriangle />{selectedSheet.classificationWarnings.join("；")}</div> : null}{selectedSheet && selectedSheet.headers.length ? <div className="table-scroll"><table className="data-table migration-preview"><thead><tr>{selectedSheet.headers.map((header) => <th key={header}>{header}</th>)}</tr></thead><tbody>{selectedSheet.previewRows.map((row, index) => <tr key={index}>{selectedSheet.headers.map((header) => <td key={header}>{String(row[header] ?? "-")}</td>)}</tr>)}</tbody></table></div> : null}</section> : null}

      {selectedSheet?.headers.length ? <section className="panel"><div className="panel-header"><div><div className="panel-title">3. 业务类型与字段映射</div><div className="panel-subtitle">精确表头与别名字典已自动建议，未识别字段保持忽略</div></div><span className="badge">规则匹配</span></div><div className="mapping-toolbar"><div className="field"><label>业务类型</label><select className="input" value={businessType} onChange={(event) => setBusinessType(event.target.value)}>{migrationDefinitions.filter((item) => allowedTypes.includes(item.resource)).map((item) => <option key={item.resource} value={item.resource}>{item.label}</option>)}</select></div><div className="field"><label>保存 Mapping Template（可选）</label><input className="input" value={templateName} onChange={(event) => setTemplateName(event.target.value)} placeholder="例如：2024-2026 项目采购总表格式" /></div></div><div className="table-scroll"><table className="data-table mapping-table"><thead><tr><th>Excel 字段</th><th>系统字段</th><th>匹配结果</th></tr></thead><tbody>{selectedSheet.headers.map((header) => <tr key={header}><td className="table-primary">{header}</td><td><select className="input" value={mappings[header] ?? ""} onChange={(event) => setMappings((current) => ({ ...current, [header]: event.target.value }))}><option value="">忽略此列</option>{fields.map((field) => <option key={field.key} value={field.key}>{field.displayLabel}{field.required ? " *" : ""}</option>)}</select></td><td><span className={`badge ${mappings[header] ? "success" : ""}`}>{mappings[header] ? "已映射" : "忽略"}</span></td></tr>)}</tbody></table></div><div className="modal-footer"><button className="button primary" onClick={() => void stage()} disabled={loading}>{loading ? <LoaderCircle className="animate-spin" /> : <CheckCircle2 />}进入暂存区预检</button></div></section> : null}

      {message ? <div className="migration-notice"><CheckCircle2 />{message}</div> : null}
      {detail && detail.rows.length ? <section className="panel"><div className="panel-header"><div><div className="panel-title">4. 暂存区预览与人工确认</div><div className="panel-subtitle">第 {detail.page} 页，每页 {detail.pageSize} 行</div></div><div className="migration-counts"><span className="badge success">可导入 {String(batchValue(detail.batch, "readyRows", "ready_rows") ?? 0)}</span><span className="badge warning">警告 {String(batchValue(detail.batch, "warningRows", "warning_rows") ?? 0)}</span><span className="badge danger">错误 {String(batchValue(detail.batch, "errorRows", "error_rows") ?? 0)}</span>{detail.unresolvedReferences > 0 ? <span className="badge warning">待确认关联 {detail.unresolvedReferences}</span> : null}{errorRows > 0 ? <a className="button small" href={`/api/migrations/batches/${String(detail.batch.id)}/errors`}><Download />导出错误行</a> : null}</div></div><div className="table-scroll"><table className="data-table staging-table"><thead><tr><th>原始行</th><th>标准化数据</th><th>关联 / 重复</th><th>状态</th><th>处理</th></tr></thead><tbody>{detail.rows.map((row) => <tr key={row.id}><td>{row.sourceRow}</td><td><div className="staging-values">{fields.slice(0, 4).map((field) => <span key={field.key}><small>{field.displayLabel}</small>{String(row.normalizedData[field.key] ?? "-")}</span>)}</div></td><td><div className="issue-list">{row.issues.length ? row.issues.slice(0, 3).map((issue, index) => <span className={issue.severity === "ERROR" ? "danger-text" : "warning-text"} key={`${issue.code}-${index}`}>{issue.message}</span>) : <span className="success-text">校验通过</span>}{(resolutionsByRow.get(row.id) ?? []).map((resolution) => resolution.candidates.length ? <select key={resolution.fieldKey} className="input compact" defaultValue="" onChange={(event) => event.target.value && void updateRow(row.id, { fieldKey: resolution.fieldKey, confirmedReferenceId: Number(event.target.value) })}><option value="">选择{resolution.inputValue}的匹配项</option>{resolution.candidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.code} · {candidate.name}</option>)}</select> : null)}</div></td><td><span className={`badge ${row.status === "ERROR" ? "danger" : row.status === "WARNING" ? "warning" : "success"}`}>{statusLabels[row.status] ?? row.status}</span></td><td><div className="row-actions"><button className="button small" onClick={() => setEditRow(row)}>编辑</button>{(row.duplicateStatus !== "NEW" || row.status === "ERROR") ? <select className="input compact" value={row.action} onChange={(event) => void updateRow(row.id, { action: event.target.value })}><option value="SKIP">跳过</option><option value="MATCH">匹配现有</option><option value="CREATE">作为新记录</option></select> : null}</div></td></tr>)}</tbody></table></div><div className="migration-footer"><div><button className="button small" disabled={detail.page <= 1 || loading} onClick={() => void loadBatch(Number(detail.batch.id), detail.page - 1)}><ArrowLeft />上一页</button><button className="button small" disabled={detail.rows.length < detail.pageSize || loading} onClick={() => void loadBatch(Number(detail.batch.id), detail.page + 1)}>下一页<ArrowRight /></button></div><div>{batchStatus === "VALIDATED" ? <button className="button" disabled={errorRows > 0 || detail.unresolvedReferences > 0 || loading} onClick={() => void batchAction("confirm")}><CheckCircle2 />人工确认</button> : null}{batchStatus === "READY_TO_IMPORT" ? <button className="button primary" disabled={loading} onClick={() => void batchAction("import")}><Database />正式导入</button> : null}{batchStatus === "COMPLETED" ? <button className="button danger" disabled={loading} onClick={() => void batchAction("rollback")}><RotateCcw />撤销批次</button> : null}</div></div></section> : null}

      <section className="panel">
        <div className="panel-header"><div><div className="panel-title">导入历史</div><div className="panel-subtitle">批次、来源、Mapping、Hash 状态与结果统计</div></div><History /></div>
        <div className="table-scroll"><table className="data-table"><thead><tr><th>批次</th><th>来源</th><th>业务类型</th><th>Mapping</th><th>总行数</th><th>结果</th><th>状态</th><th></th></tr></thead><tbody>{overview?.batches.map((batch) => <tr key={String(batch.id)}>
          <td className="table-primary">{String(batch.batchNumber)}<div className="table-secondary">Hash {String(batch.sourceHash ?? "").slice(0, 10)}</div></td>
          <td><span className="badge">{sourceChannelLabels[String(batch.sourceChannel)] ?? String(batch.sourceChannel ?? "-")}</span><div>{String(batch.filename ?? "-")}</div><div className="table-secondary">{String(batch.sheetName ?? "未选择 Sheet")}</div></td>
          <td>{businessLabels[String(batch.businessType)] ?? String(batch.businessType ?? "-")}</td><td>{String(batch.mappingName ?? "临时映射")}</td><td>{String(batch.totalRows)}</td>
          <td><span className="success-text">{String(batch.successRows)}</span> / <span className="warning-text">{String(batch.skippedRows)}</span> / <span className="danger-text">{String(batch.errorRows)}</span></td>
          <td><span className={`badge ${batch.status === "COMPLETED" ? "success" : batch.status === "ROLLED_BACK" ? "danger" : "warning"}`}>{statusLabels[String(batch.status)] ?? String(batch.status)}</span></td>
          <td><button className="button small" onClick={() => void loadBatch(Number(batch.id))}>查看</button></td>
        </tr>)}</tbody></table></div>
      </section>
    </div>
    {editRow ? <EditStagingModal row={editRow} fields={fields.filter((field) => !field.reference)} onClose={() => setEditRow(null)} onSave={(updates) => void updateRow(editRow.id, { updates })} /> : null}
  </>;
}

function EditStagingModal({ row, fields, onClose, onSave }: { row: StagingRow; fields: NonNullable<ReturnType<typeof migrationDefinition>>["fields"]; onClose: () => void; onSave: (updates: Record<string, unknown>) => void }) {
  const [values, setValues] = useState<Record<string, unknown>>(() => Object.fromEntries(fields.map((field) => [field.key, row.normalizedData[field.key] ?? ""])));
  return <div className="modal-backdrop"><div className="modal"><div className="modal-header"><div className="modal-title">修改暂存数据 · 原始行 {row.sourceRow}</div><button className="icon-plain" onClick={onClose}>×</button></div><div className="form-grid">{fields.map((field) => <div className="field" key={field.key}><label>{field.displayLabel}{field.required ? <span className="required">*</span> : null}</label><input className="input" type={field.type === "number" ? "number" : field.type === "date" ? "date" : "text"} value={String(values[field.key] ?? "")} onChange={(event) => setValues((current) => ({ ...current, [field.key]: field.type === "number" ? Number(event.target.value) : event.target.value }))} /></div>)}</div><div className="modal-footer"><button className="button" onClick={onClose}>取消</button><button className="button primary" onClick={() => onSave(values)}><Save />保存并复检</button></div></div></div>;
}



