"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle, ArrowLeft, ArrowRight, BriefcaseBusiness, Building2, CheckCircle2, ChevronDown,
  Database, Download, FileSpreadsheet, FolderOpen, History, Library, LoaderCircle, RotateCcw,
  Save, Search, ShieldAlert, Sparkles, Upload,
} from "lucide-react";
import { migrationDefinition, migrationDefinitions, suggestFieldMappings, type MigrationIssue } from "@/data/data-migration-rules";
import type { ConfidenceLevel, ImportScope, IntelligentWorkbookAnalysis, RecognizedBusinessFact } from "@/data/import-intelligence";

type SheetInfo = {
  id: number; name: string; rowCount: number; columnCount: number; imageCount?: number; headers: string[]; previewRows: Record<string, unknown>[];
  classification?: string; classificationConfidence?: number; classificationWarnings?: string[]; recognizedFacts?: RecognizedBusinessFact[];
  learnedMappings?: Record<string, Record<string, string>>; matchedTemplate?: { id: number; name: string; businessType: string; mappings: Record<string, string> } | null;
};
type ProjectOption = { id: number; name: string; code: string; companyId: number | null; companyName: string };
type CompanyOption = { id: number; name: string; code: string };
type Workbook = {
  batchId: number; batchNumber: string; filename: string; fileSize: number; sheetCount: number; fingerprintStatus?: string; versionNumber?: number;
  imageCount?: number;
  sourceGroupKey?: string; duplicateOf: string | null; scope: ImportScope; projectId: number | null; companyId: number | null; contextConfirmed: boolean;
  projectConflict?: { currentProject: string; detectedProject: string; confidence: number } | null; analysis: IntelligentWorkbookAnalysis; sheets: SheetInfo[];
};
type StagingRow = { id: number; sourceRow: number; sheetName?: string; normalizedData: Record<string, unknown>; issues: MigrationIssue[]; duplicateStatus: string; duplicateTargetId: number | null; action: string; status: string; targetTable?: string; targetId?: number };
type Resolution = { stagingRowId: number; fieldKey: string; entityType: string; inputValue: string; status: string; candidates: { id: number; name: string; code: string }[] };
type StoredFact = { id: number; factType: string; confidence: number; confidenceLevel: ConfidenceLevel; status: string; payload: { label?: string; resource?: string | null; plannedCount?: number; sheetName?: string } };
type BatchDetail = { batch: Record<string, unknown>; file: Record<string, unknown>; sheets: SheetInfo[]; rows: StagingRow[]; resolutions: Resolution[]; facts: StoredFact[]; unresolvedReferences: number; page: number; pageSize: number };
type Overview = { summary: Record<string, number>; batches: Record<string, unknown>[]; projects: ProjectOption[]; companies: CompanyOption[] };
type ScannedFile = { path: string; filename: string; extension: string; size: number; modifiedAt: string; hash: string | null; status: string; previousBatchNumber: string | null; projectCandidate?: string | null; projectCandidateSource?: string | null; error: string | null };
type ProjectCandidateGroup = { name: string; fileCount: number; status: "REQUIRES_CONFIRMATION" };

const migrationOrder = ["数据归属", "项目确认", "规则分析", "异常确认", "暂存预检", "人工确认", "正式写入", "血缘归档"];
const statusLabels: Record<string, string> = { UPLOADED: "待确认归属", PROJECT_CONFLICT: "项目冲突", VALIDATED: "预检完成", READY_TO_IMPORT: "待正式导入", COMPLETED: "已完成", ROLLED_BACK: "已撤销", READY: "可导入", WARNING: "需确认", ERROR: "错误", CONFIRMED: "已确认", IMPORTED: "已导入", SKIPPED: "已跳过" };
const fingerprintLabels: Record<string, string> = { NEW: "新文件", UPDATED: "新版本", UNCHANGED: "未变化", DUPLICATE: "重复文件", UNSUPPORTED: "不支持", ERROR: "读取错误" };
const sourceChannelLabels: Record<string, string> = { UPLOAD_UI: "网页上传", FOLDER: "服务器文件夹", EXTERNAL_API: "外部 API" };
const classificationLabels: Record<string, string> = { PROJECT_SUMMARY: "项目汇总", CONTRACT: "合同", PROJECT_COST: "项目成本", SKU_DETAIL: "SKU 明细", SUPPLIER_QUOTE: "供应商报价", PURCHASE_ORDER: "采购订单", PAYABLE: "应付", PAYMENT: "付款", RECEIVABLE: "应收", RECEIPT: "收款", INVOICE: "发票", REFERENCE: "基础资料", EMPTY: "空 Sheet", UNKNOWN: "待识别" };
const classificationResources: Record<string, string> = { PROJECT_SUMMARY: "projects", CONTRACT: "contracts", PROJECT_COST: "skus", SKU_DETAIL: "skus", SUPPLIER_QUOTE: "quotes", PURCHASE_ORDER: "purchase-requests", PAYABLE: "payables", PAYMENT: "payments", RECEIVABLE: "receivables", RECEIPT: "receipts", INVOICE: "invoices" };
const businessLabels = Object.fromEntries(migrationDefinitions.map((item) => [item.resource, item.label]));
const scopeLabels: Record<string, string> = { PENDING: "待确认", PROJECT: "项目数据", COMPANY: "公司级数据", MASTER: "公共主数据" };
const confidenceLabels: Record<string, string> = { HIGH: "高置信度", MEDIUM: "建议确认", LOW: "需要确认", CONFLICT: "冲突" };
const batchValue = (batch: Record<string, unknown>, camel: string, snake: string) => batch[camel] ?? batch[snake];
const factStatusLabel = (status: string, level: ConfidenceLevel) => status === "AUTO_ACCEPTED" ? "已自动确认" : status === "USER_ACCEPTED" ? "已确认" : status === "IGNORED" ? "已保留原表" : confidenceLabels[level];
const factStatusTone = (status: string, level: ConfidenceLevel) => status === "AUTO_ACCEPTED" || status === "USER_ACCEPTED" ? "success" : level === "LOW" || level === "CONFLICT" ? "danger" : "warning";

export function DataMigrationCenter({ allowedTypes, dataMode, initialMode, isOwner }: { allowedTypes: string[]; dataMode: "real" | "demo"; initialMode: "upload" | "folder"; isOwner: boolean }) {
  const [mode, setMode] = useState<"upload" | "folder">(initialMode);
  const [workbook, setWorkbook] = useState<Workbook | null>(null);
  const [selectedSheet, setSelectedSheet] = useState<SheetInfo | null>(null);
  const [businessType, setBusinessType] = useState(allowedTypes[0] ?? "customers");
  const [mappings, setMappings] = useState<Record<string, string>>({});
  const [templateName, setTemplateName] = useState("");
  const [detail, setDetail] = useState<BatchDetail | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [editRow, setEditRow] = useState<StagingRow | null>(null);
  const [folderPath, setFolderPath] = useState("");
  const [recursive, setRecursive] = useState(false);
  const [scanFiles, setScanFiles] = useState<ScannedFile[]>([]);
  const [scanProjectGroups, setScanProjectGroups] = useState<ProjectCandidateGroup[]>([]);
  const [dragging, setDragging] = useState(false);
  const [scope, setScope] = useState<Exclude<ImportScope, "PENDING">>("PROJECT");
  const [projectMode, setProjectMode] = useState<"new" | "existing">("new");
  const [companyMode, setCompanyMode] = useState<"new" | "existing">("existing");
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [selectedCompanyId, setSelectedCompanyId] = useState("");
  const [projectName, setProjectName] = useState("");
  const [projectCode, setProjectCode] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [companyPromptOpen, setCompanyPromptOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const definition = migrationDefinition(businessType);

  async function readJson(response: Response) { const data = await response.json(); if (!response.ok) throw new Error(data.error ?? "操作失败"); return data; }
  async function refreshOverview() { const response = await fetch("/api/migrations/batches"); if (response.ok) setOverview(await response.json()); }
  async function loadBatch(batchId: number, page = 1) {
    setLoading(true);
    try {
      const data = await readJson(await fetch(`/api/migrations/batches/${batchId}?page=${page}`)) as BatchDetail;
      setDetail(data);
      const batch = data.batch; const file = data.file;
      const analysis = (batch.analysis_summary ?? batch.analysis) as IntelligentWorkbookAnalysis;
      const nextScope = String(batch.scope_type ?? batch.scopeType ?? "PENDING") as ImportScope;
      const nextProjectId = Number(batch.project_id ?? batch.projectId) || null;
      const nextCompanyId = Number(batch.company_id ?? batch.companyId) || null;
      const currentBatch = workbook?.batchId === batchId;
      setWorkbook({
        batchId,
        batchNumber: String(batch.batch_number ?? batch.batchNumber),
        filename: String(file.filename ?? ""),
        fileSize: Number(file.fileSize ?? 0),
        sheetCount: Number(file.sheetCount ?? data.sheets.length),
        fingerprintStatus: String(file.fingerprintStatus ?? "NEW"),
        versionNumber: Number(file.versionNumber ?? 1),
        duplicateOf: currentBatch ? workbook?.duplicateOf ?? null : null,
        scope: nextScope,
        projectId: nextProjectId,
        companyId: nextCompanyId,
        contextConfirmed: Boolean(batch.context_confirmed ?? batch.contextConfirmed),
        projectConflict: (batch.project_conflict ?? batch.projectConflict ?? null) as Workbook["projectConflict"],
        analysis,
        imageCount: data.sheets.reduce((sum, sheet) => sum + Number(sheet.imageCount ?? 0), 0),
        sheets: data.sheets,
      });
      const preferred = data.sheets.find((sheet) => sheet.id === selectedSheet?.id) ?? data.sheets.find((sheet) => sheet.recognizedFacts?.some((fact) => fact.resource === "skus")) ?? data.sheets.find((sheet) => !["EMPTY", "UNKNOWN", "REFERENCE"].includes(sheet.classification ?? "UNKNOWN")) ?? data.sheets[0] ?? null;
      setSelectedSheet(preferred);
      const storedBusinessType = String(batch.business_type ?? batch.businessType ?? "");
      if (allowedTypes.includes(storedBusinessType)) setBusinessType(storedBusinessType);
      setScope(nextScope === "PENDING" ? analysis.scopeSuggestion : nextScope);
      if (nextProjectId) { setSelectedProjectId(String(nextProjectId)); setProjectMode("existing"); }
      setSelectedCompanyId(nextCompanyId ? String(nextCompanyId) : "");
      if (!currentBatch) { setProjectName(analysis.projectCandidate?.name ?? ""); setAdvancedOpen(false); }
    } catch (error) { setMessage(error instanceof Error ? error.message : "读取批次失败"); }
    finally { setLoading(false); }
  }
  useEffect(() => { void refreshOverview(); }, []);
  useEffect(() => {
    if (!selectedSheet) return;
    const matched = selectedSheet.matchedTemplate;
    const intelligent = selectedSheet.recognizedFacts?.find((fact) => fact.resource === businessType)?.mappings ?? [];
    const intelligentMappings = Object.fromEntries(intelligent.map((mapping) => [mapping.sourceField, mapping.targetField]));
    if (matched?.businessType === businessType) { setMappings(matched.mappings); setTemplateName(matched.name); }
    else { setMappings({ ...suggestFieldMappings(businessType, selectedSheet.headers), ...intelligentMappings, ...(selectedSheet.learnedMappings?.[businessType] ?? {}) }); setTemplateName(""); }
  }, [businessType, selectedSheet]);

  function selectWorkbook(data: Workbook) {
    const firstSheet = data.sheets.find((sheet) => sheet.recognizedFacts?.some((fact) => fact.resource === "skus")) ?? data.sheets.find((sheet) => !["EMPTY", "UNKNOWN", "REFERENCE"].includes(sheet.classification ?? "UNKNOWN")) ?? data.sheets.find((sheet) => sheet.classification !== "EMPTY") ?? data.sheets[0] ?? null;
    setWorkbook(data); setSelectedSheet(firstSheet); setDetail(null); setAdvancedOpen(false);
    const suggestedScope = data.scope === "PENDING" ? data.analysis.scopeSuggestion : data.scope;
    setScope(suggestedScope);
    const candidate = data.analysis.projectCandidate?.name ?? "";
    setProjectName(candidate); setProjectCode(""); setSelectedProjectId(data.projectId ? String(data.projectId) : "");
    const existing = overview?.projects.find((project) => project.name === candidate || (candidate && (project.name.includes(candidate) || candidate.includes(project.name))));
    setProjectMode(data.projectId || existing ? "existing" : "new"); if (!data.projectId && existing) setSelectedProjectId(String(existing.id));
    const suggestedResource = firstSheet?.recognizedFacts?.find((fact) => fact.resource && allowedTypes.includes(fact.resource))?.resource ?? (firstSheet?.classification ? classificationResources[firstSheet.classification] : undefined);
    if (suggestedResource && allowedTypes.includes(suggestedResource)) setBusinessType(suggestedResource);
  }

  async function upload(files?: FileList | File[]) {
    const selected = files ? Array.from(files).slice(0, 20) : [];
    if (!selected.length) return; setLoading(true); setMessage(`正在解析 ${selected.length} 个文件...`); setDetail(null);
    try {
      let latest: Workbook | null = null;
      for (const file of selected) { const form = new FormData(); form.set("file", file); latest = await readJson(await fetch("/api/migrations/workbook", { method: "POST", body: form })) as Workbook; }
      if (latest) selectWorkbook(latest);
      setMessage(`${selected.length} 个文件已完成本地解析；请先确认数据归属`); await refreshOverview();
    } catch (error) { setMessage(error instanceof Error ? error.message : "上传失败"); }
    finally { setLoading(false); if (inputRef.current) inputRef.current.value = ""; }
  }

  async function scanFolder() {
    setLoading(true); setMessage("正在只读扫描允许目录..."); setScanFiles([]); setScanProjectGroups([]);
    try { const result = await readJson(await fetch("/api/imports/scan-folder", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ folderPath, recursive }) })); setScanFiles(result.files); setScanProjectGroups(result.projectGroups ?? []); setMessage(`扫描完成：发现 ${result.files.length} 个文件，目录名仅作为项目候选`); }
    catch (error) { setMessage(error instanceof Error ? error.message : "扫描失败"); } finally { setLoading(false); }
  }

  async function stageFolderFile(path: string) {
    setLoading(true); setMessage("正在复制原文件并创建分析批次...");
    try { const data = await readJson(await fetch("/api/imports/stage-file", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path }) })) as Workbook; selectWorkbook(data); setMessage(`文件已解析：${data.batchNumber}，请确认项目归属`); await refreshOverview(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "暂存失败"); } finally { setLoading(false); }
  }

  async function confirmContext(overrideConflict = false) {
    if (!workbook) return;
    setLoading(true); setMessage("正在锁定数据归属并执行项目隔离检查...");
    try {
      const result = await readJson(await fetch("/api/migrations/context", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
          batchId: workbook.batchId, scope,
          projectId: scope === "PROJECT" && projectMode === "existing" ? Number(selectedProjectId) || null : null,
          projectName: scope === "PROJECT" && projectMode === "new" ? projectName : "",
          projectCode: scope === "PROJECT" && projectMode === "new" ? projectCode : "",
          createProject: scope === "PROJECT" && projectMode === "new",
          companyId: Number(selectedCompanyId) || null,
          companyName: scope === "COMPANY" && companyMode === "new" ? companyName : "",
          createCompany: scope === "COMPANY" && companyMode === "new",
          overrideConflict,
        }),
      }));
      setWorkbook((current) => current ? { ...current, scope, projectId: result.project?.id ?? null, companyId: result.project?.companyId ?? result.company?.id ?? null, contextConfirmed: result.contextConfirmed, projectConflict: result.conflict } : current);
      if (result.project?.id) { setSelectedProjectId(String(result.project.id)); setProjectMode("existing"); }
      if (result.conflict) setMessage("文件中的项目名与目标项目不一致，请确认后再继续");
      else if (scope === "PROJECT") {
        setMessage("归属已确认，正在自动识别全部产品明细和图片...");
        try {
          const staged = await readJson(await fetch("/api/migrations/stage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ batchId: workbook.batchId, sheetId: selectedSheet?.id ?? 0, businessType: "skus", mappings: {}, autoAllSheets: true }) }));
          setBusinessType("skus");
          setMessage(`智能预检完成：${staged.sheetCount} 个明细 Sheet，${staged.total} 条产品，${staged.imageRows} 条已关联图片；${staged.error} 条需要修正`);
        } catch (autoError) {
          setMessage(`归属已确认；自动预检未完成：${autoError instanceof Error ? autoError.message : "请使用手动修正"}`);
        }
      } else setMessage(`数据归属已确认：${scopeLabels[scope]}`);
      await refreshOverview(); await loadBatch(workbook.batchId);
    } catch (error) { setMessage(error instanceof Error ? error.message : "数据归属确认失败"); } finally { setLoading(false); }
  }

  async function reviewFact(factId: number, decision: "ACCEPT" | "IGNORE") {
    if (!workbook) return; setLoading(true);
    try { await readJson(await fetch(`/api/migrations/batches/${workbook.batchId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operation: "review-fact", factId, decision }) })); await loadBatch(workbook.batchId); setMessage(decision === "ACCEPT" ? "识别项已确认" : "识别项已保留为原始证据并忽略结构化导入"); }
    catch (error) { setMessage(error instanceof Error ? error.message : "识别项处理失败"); } finally { setLoading(false); }
  }

  async function stage(automatic = false) {
    if (!workbook || !selectedSheet) return; setLoading(true); setMessage(automatic && batchStatus === "READY_TO_IMPORT" ? "正在重新运行规则预检；完成后需要再次确认预检结果..." : "正在运行本地规则预检：字段识别、关联匹配、重复检测、图片绑定与业务校验...");
    try {
      const result = await readJson(await fetch("/api/migrations/stage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ batchId: workbook.batchId, sheetId: selectedSheet.id, businessType, mappings, saveTemplateName: templateName.trim() || undefined, autoAllSheets: automatic }) }));
      if (automatic) setBusinessType("skus");
      setMessage(automatic ? `智能预检完成：${result.sheetCount} 个明细 Sheet，${result.total} 条产品，${result.imageRows} 条已关联图片；${result.error} 条需要修正` : `预检完成：${result.ready} 行可导入，${result.warning} 行需确认，${result.error} 行错误`); await loadBatch(workbook.batchId); await refreshOverview();
    } catch (error) { const text = error instanceof Error ? error.message : "预检失败"; setMessage(text); if (text.includes("字段映射")) setAdvancedOpen(true); } finally { setLoading(false); }
  }

  async function batchAction(action: "confirm" | "import" | "rollback") {
    if (!detail) return; const batchId = Number(detail.batch.id); let confirmation = "";
    const batchScope = String(batchValue(detail.batch, "scopeType", "scope_type") ?? "");
    const batchCompanyId = Number(batchValue(detail.batch, "companyId", "company_id")) || null;
    if (action === "import" && batchScope === "PROJECT" && !batchCompanyId) { setCompanyPromptOpen(true); setMessage("正式导入前需要为当前项目选择所属公司"); return; }
    if (action === "confirm" && dataMode === "real") { confirmation = window.prompt("输入“确认导入真实数据”以锁定当前预检结果") ?? ""; if (confirmation !== "确认导入真实数据") { setMessage("确认短语不匹配，未改变任何数据"); return; } }
    setLoading(true); setMessage(action === "import" ? "正式数据原子写入中..." : action === "rollback" ? "检查下游引用并撤销中..." : "确认暂存数据中...");
    try { const result = await readJson(await fetch(`/api/migrations/batches/${batchId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, confirmation }) })); if (action === "rollback" && result.ok === false) throw new Error(`无法自动撤销：${result.blocked.slice(0, 3).join("；")}`); setMessage(action === "confirm" ? "人工确认完成，可以正式导入" : action === "import" ? "批次已原子写入并保存项目级血缘" : "批次已安全撤销"); await loadBatch(batchId); await refreshOverview(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "批次操作失败"); } finally { setLoading(false); }
  }

  async function assignCompanyAndImport() {
    if (!detail || !selectedCompanyId) { setMessage("请先选择所属公司"); return; }
    const batchId = Number(detail.batch.id); setLoading(true); setMessage("正在绑定项目公司并原子写入正式数据...");
    try {
      await readJson(await fetch(`/api/migrations/batches/${batchId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operation: "assign-company", companyId: Number(selectedCompanyId) }) }));
      await readJson(await fetch(`/api/migrations/batches/${batchId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "import" }) }));
      setCompanyPromptOpen(false); setMessage("所属公司已绑定，批次已原子写入并保存项目级血缘"); await loadBatch(batchId); await refreshOverview();
    } catch (error) { setMessage(error instanceof Error ? error.message : "绑定公司或正式导入失败"); }
    finally { setLoading(false); }
  }

  async function updateRow(rowId: number, payload: Record<string, unknown>) {
    if (!detail) return; const batchId = Number(detail.batch.id); setLoading(true);
    try { await readJson(await fetch(`/api/migrations/batches/${batchId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operation: "update-row", rowId, ...payload }) })); await loadBatch(batchId, detail.page); setEditRow(null); setMessage("暂存行已更新并完成复检"); }
    catch (error) { setMessage(error instanceof Error ? error.message : "暂存行修改失败"); } finally { setLoading(false); }
  }

  const fields = definition?.fields ?? [];
  const batchStatus = detail ? String(detail.batch.status) : "";
  const errorRows = detail ? Number(batchValue(detail.batch, "errorRows", "error_rows") ?? 0) : 0;
  const resolutionsByRow = useMemo(() => new Map((detail?.resolutions ?? []).map((resolution) => [resolution.stagingRowId, [...((detail?.resolutions ?? []).filter((item) => item.stagingRowId === resolution.stagingRowId))]])), [detail]);
  const facts = detail?.facts ?? [];
  const pendingFacts = facts.filter((fact) => ["REQUIRES_CONFIRMATION", "CONFLICT"].includes(fact.status));
  const projectLabel = overview?.projects.find((project) => project.id === workbook?.projectId)?.name ?? (projectName || "不绑定项目");

  return <>
    <div className="migration-mode" role="tablist" aria-label="数据来源">
      <button className={mode === "upload" ? "active" : ""} onClick={() => setMode("upload")}><Upload />上传文件</button>
      <button className={mode === "folder" ? "active" : ""} onClick={() => setMode("folder")}><FolderOpen />扫描文件夹</button>
    </div>
    <div className="migration-stack">
      <section className="migration-overview">
        <div className="panel migration-guide"><div className="panel-header"><div><div className="panel-title">智能导入流程</div><div className="panel-subtitle">高置信项自动处理，用户只确认异常</div></div></div><div className="migration-order">{migrationOrder.map((item, index) => <div key={item}><span>{String(index + 1).padStart(2, "0")}</span><strong>{item}</strong></div>)}</div></div>
        <div className="panel"><div className="panel-header"><div><div className="panel-title">当前数据基线</div><div className="panel-subtitle">正式库实时统计</div></div></div><div className="migration-baseline">{[["项目", overview?.summary.projects], ["供应商", overview?.summary.suppliers], ["SKU", overview?.summary.skus], ["采购", overview?.summary.purchases], ["付款", overview?.summary.payments]].map(([label, value]) => <div key={String(label)}><span>{label}</span><strong>{Number(value ?? 0).toLocaleString("zh-CN")}</strong></div>)}</div></div>
      </section>

      {mode === "upload" ? <section className="panel">
        <div className="panel-header"><div><div className="panel-title">1. 上传原始文件</div><div className="panel-subtitle">文件先在本地解析，不会直接写入正式业务表</div></div>{workbook ? <span className="badge success">{workbook.batchNumber}</span> : null}</div>
        <div className={`migration-upload ${dragging ? "is-dragging" : ""}`} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); void upload(event.dataTransfer.files); }}><input ref={inputRef} type="file" accept=".xlsx,.xls,.csv" multiple onChange={(event) => void upload(event.target.files ?? undefined)} /><button className="button primary" onClick={() => inputRef.current?.click()} disabled={loading}>{loading ? <LoaderCircle className="animate-spin" /> : <Upload />}选择文件</button>{workbook ? <div><strong>{workbook.filename}</strong><span>{(workbook.fileSize / 1024).toFixed(1)} KB · {workbook.sheetCount} 个 Sheet · {workbook.imageCount ?? 0} 张内嵌图片 · V{workbook.versionNumber ?? 1} · {fingerprintLabels[workbook.fingerprintStatus ?? "NEW"]}</span></div> : <span>支持一次选择最多 20 个 .xlsx / .xls / .csv 文件，单文件上限 60MB</span>}</div>
        {workbook?.duplicateOf ? <div className="migration-notice warning"><AlertTriangle />{fingerprintLabels[workbook.fingerprintStatus ?? "DUPLICATE"]}，关联历史批次 {workbook.duplicateOf}，请核实后再继续。</div> : null}
      </section> : <FolderScanner isOwner={isOwner} loading={loading} folderPath={folderPath} setFolderPath={setFolderPath} recursive={recursive} setRecursive={setRecursive} scanFiles={scanFiles} projectGroups={scanProjectGroups} scanFolder={scanFolder} stageFolderFile={stageFolderFile} />}

      {workbook ? <ContextPanel workbook={workbook} overview={overview} scope={scope} setScope={setScope} projectMode={projectMode} setProjectMode={setProjectMode} companyMode={companyMode} setCompanyMode={setCompanyMode} selectedProjectId={selectedProjectId} setSelectedProjectId={setSelectedProjectId} selectedCompanyId={selectedCompanyId} setSelectedCompanyId={setSelectedCompanyId} projectName={projectName} setProjectName={setProjectName} projectCode={projectCode} setProjectCode={setProjectCode} companyName={companyName} setCompanyName={setCompanyName} isOwner={isOwner} loading={loading} confirmContext={confirmContext} /> : null}

      {workbook?.projectConflict ? <section className="panel project-conflict-panel"><div className="panel-header"><div><div className="panel-title"><ShieldAlert />发现项目冲突</div><div className="panel-subtitle">默认禁止继续自动导入</div></div><span className="badge danger">CONFLICT</span></div><div className="conflict-compare"><div><small>当前目标项目</small><strong>{workbook.projectConflict.currentProject}</strong></div><ArrowRight /><div><small>文件中识别到</small><strong>{workbook.projectConflict.detectedProject}</strong></div></div><div className="migration-footer"><span>可在上方切换项目，或明确确认仍归入当前项目。</span><button className="button danger" disabled={loading} onClick={() => void confirmContext(true)}>仍归入当前项目</button></div></section> : null}

      {workbook?.contextConfirmed ? <AnalysisPanel workbook={workbook} facts={facts} pendingFacts={pendingFacts} projectLabel={projectLabel} selectedSheet={selectedSheet} loading={loading} feedback={message} batchStatus={batchStatus} reviewFact={reviewFact} stage={() => stage(true)} /> : null}

      {workbook ? <SheetPanel workbook={workbook} selectedSheet={selectedSheet} setSelectedSheet={setSelectedSheet} setBusinessType={setBusinessType} allowedTypes={allowedTypes} /> : null}

      {workbook?.contextConfirmed && selectedSheet?.headers.length ? <section className="panel advanced-mapping-panel"><button className="advanced-mapping-toggle" onClick={() => setAdvancedOpen((value) => !value)} aria-expanded={advancedOpen}><span><strong>识别有误？手动修正</strong><small>系统已自动处理；只有预检报错或业务类型判断错误时才需要打开</small></span><ChevronDown className={advancedOpen ? "is-open" : ""} /></button>{advancedOpen ? <><div className="mapping-toolbar"><div className="field"><label>这张表属于</label><select className="input" value={businessType} onChange={(event) => setBusinessType(event.target.value)}>{migrationDefinitions.filter((item) => allowedTypes.includes(item.resource)).map((item) => <option key={item.resource} value={item.resource}>{item.label}</option>)}</select></div><div className="field"><label>记住这类表格的规则（可选）</label><input className="input" value={templateName} onChange={(event) => setTemplateName(event.target.value)} placeholder="例如：项目采购总表" /></div></div><div className="table-scroll"><table className="data-table mapping-table"><thead><tr><th>原表列名</th><th>导入到</th><th>状态</th></tr></thead><tbody>{selectedSheet.headers.map((header) => <tr key={header}><td className="table-primary">{header}</td><td><select className="input" value={mappings[header] ?? ""} onChange={(event) => setMappings((current) => ({ ...current, [header]: event.target.value }))}><option value="">只保留原始内容，不写入字段</option>{fields.map((field) => <option key={field.key} value={field.key}>{field.displayLabel}{field.required ? " *" : ""}</option>)}</select></td><td><span className={`badge ${mappings[header] ? "success" : ""}`}>{mappings[header] ? "已识别" : "仅留存"}</span></td></tr>)}</tbody></table></div><div className="modal-footer"><button className="button primary" onClick={() => void stage(false)} disabled={loading || !workbook?.contextConfirmed}>{loading ? <LoaderCircle className="animate-spin" /> : <CheckCircle2 />}按当前修正重新预检</button></div></> : null}</section> : null}

      {message ? <div className={`migration-notice ${message.includes("冲突") || message.includes("失败") || message.includes("必须") ? "warning" : ""}`}><CheckCircle2 />{message}</div> : null}

      {detail?.rows.length ? <StagingPanel detail={detail} fields={fields} batchStatus={batchStatus} errorRows={errorRows} pendingFacts={pendingFacts} loading={loading} feedback={message} resolutionsByRow={resolutionsByRow} loadBatch={loadBatch} updateRow={updateRow} setEditRow={setEditRow} batchAction={batchAction} /> : null}

      <HistoryPanel overview={overview} loadBatch={loadBatch} />
    </div>
    {editRow ? <EditStagingModal row={editRow} fields={fields.filter((field) => !field.reference)} onClose={() => setEditRow(null)} onSave={(updates) => void updateRow(editRow.id, { updates })} /> : null}
    {companyPromptOpen && detail ? <AssignProjectCompanyModal projectName={projectLabel} rowCount={Number(batchValue(detail.batch, "totalRows", "total_rows") ?? 0)} companies={overview?.companies ?? []} companyId={selectedCompanyId} setCompanyId={setSelectedCompanyId} loading={loading} onClose={() => setCompanyPromptOpen(false)} onConfirm={assignCompanyAndImport} /> : null}
  </>;
}

function FolderScanner(props: { isOwner: boolean; loading: boolean; folderPath: string; setFolderPath: (value: string) => void; recursive: boolean; setRecursive: (value: boolean) => void; scanFiles: ScannedFile[]; projectGroups: ProjectCandidateGroup[]; scanFolder: () => Promise<void>; stageFolderFile: (path: string) => Promise<void> }) {
  return <section className="panel"><div className="panel-header"><div><div className="panel-title">1. 扫描服务器文件夹</div><div className="panel-subtitle">一级目录只作为项目候选，确认前不会自动创建项目</div></div></div>{props.isOwner ? <><div className="folder-scan-toolbar"><div className="field"><label>服务器文件夹路径</label><input className="input" value={props.folderPath} onChange={(event) => props.setFolderPath(event.target.value)} placeholder="请输入 IMPORT_ALLOWED_ROOTS 内的目录" /></div><label className="folder-scan-check"><input type="checkbox" checked={props.recursive} onChange={(event) => props.setRecursive(event.target.checked)} />包含子文件夹</label><button className="button primary" disabled={props.loading || !props.folderPath.trim()} onClick={() => void props.scanFolder()}>{props.loading ? <LoaderCircle className="animate-spin" /> : <Search />}开始扫描</button></div>{props.projectGroups.length ? <div className="project-candidate-groups">{props.projectGroups.map((group) => <div key={group.name}><BriefcaseBusiness /><span><strong>{group.name}</strong><small>{group.fileCount} 个文件 · 待确认创建或匹配</small></span></div>)}</div> : null}{props.scanFiles.length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>文件</th><th>项目候选</th><th>修改时间</th><th>大小</th><th>指纹状态</th><th></th></tr></thead><tbody>{props.scanFiles.map((file) => <tr key={file.path}><td className="table-primary">{file.filename}<div className="table-secondary">{file.path}</div></td><td>{file.projectCandidate ?? "待内容识别"}<div className="table-secondary">{file.projectCandidateSource === "FOLDER" ? "来自一级目录" : file.projectCandidateSource === "FILENAME" ? "来自文件名" : "-"}</div></td><td>{file.modifiedAt ? new Date(file.modifiedAt).toLocaleString("zh-CN") : "-"}</td><td>{file.size ? `${(file.size / 1024).toFixed(1)} KB` : "-"}</td><td><span className={`badge ${file.status === "NEW" || file.status === "UPDATED" ? "success" : file.status === "ERROR" || file.status === "UNSUPPORTED" ? "danger" : "warning"}`}>{fingerprintLabels[file.status] ?? file.status}</span>{file.error ? <div className="table-secondary danger-text">{file.error}</div> : null}</td><td><button className="button small" disabled={props.loading || !["NEW", "UPDATED", "DUPLICATE", "UNCHANGED"].includes(file.status)} onClick={() => void props.stageFolderFile(file.path)}>分析文件</button></td></tr>)}</tbody></table></div> : null}</> : <div className="migration-notice warning"><AlertTriangle />服务器文件夹扫描仅对老板账号开放。</div>}</section>;
}

function ContextPanel(props: {
  workbook: Workbook; overview: Overview | null; scope: Exclude<ImportScope, "PENDING">; setScope: (value: Exclude<ImportScope, "PENDING">) => void;
  projectMode: "new" | "existing"; setProjectMode: (value: "new" | "existing") => void; companyMode: "new" | "existing"; setCompanyMode: (value: "new" | "existing") => void;
  selectedProjectId: string; setSelectedProjectId: (value: string) => void; selectedCompanyId: string; setSelectedCompanyId: (value: string) => void;
  projectName: string; setProjectName: (value: string) => void; projectCode: string; setProjectCode: (value: string) => void; companyName: string; setCompanyName: (value: string) => void;
  isOwner: boolean; loading: boolean; confirmContext: () => Promise<void>;
}) {
  const disabled = props.loading || props.workbook.contextConfirmed || (props.scope === "PROJECT" && props.projectMode === "new" && !props.projectName.trim()) || (props.scope === "PROJECT" && props.projectMode === "existing" && !props.selectedProjectId) || (props.scope === "COMPANY" && props.companyMode === "existing" && !props.selectedCompanyId) || (props.scope === "COMPANY" && props.companyMode === "new" && !props.companyName.trim());
  return <section className="panel import-context-panel"><div className="panel-header"><div><div className="panel-title">2. 确认数据归属</div><div className="panel-subtitle">项目数据必须在暂存前绑定项目；公司级和主数据使用各自作用域</div></div>{props.workbook.contextConfirmed ? <span className="badge success"><CheckCircle2 />已锁定</span> : <span className="badge warning">待确认</span>}</div><div className="scope-selector" role="radiogroup" aria-label="数据归属"><button disabled={props.workbook.contextConfirmed} className={props.scope === "PROJECT" ? "active" : ""} onClick={() => props.setScope("PROJECT")}><BriefcaseBusiness /><span><strong>项目数据</strong><small>成本、采购、付款、发票等</small></span></button><button disabled={props.workbook.contextConfirmed} className={props.scope === "COMPANY" ? "active" : ""} onClick={() => props.setScope("COMPANY")}><Building2 /><span><strong>公司级数据</strong><small>账户、公司汇总等</small></span></button><button disabled={props.workbook.contextConfirmed} className={props.scope === "MASTER" ? "active" : ""} onClick={() => props.setScope("MASTER")}><Library /><span><strong>公共主数据</strong><small>供应商、客户、字典等</small></span></button></div>{props.scope === "PROJECT" ? <div className="context-form"><div className="context-mode"><label><input disabled={props.workbook.contextConfirmed} type="radio" checked={props.projectMode === "new"} onChange={() => props.setProjectMode("new")} />新建项目</label><label><input disabled={props.workbook.contextConfirmed} type="radio" checked={props.projectMode === "existing"} onChange={() => props.setProjectMode("existing")} />导入到已有项目</label></div>{props.projectMode === "existing" ? <div className="field"><label>目标项目</label><select disabled={props.workbook.contextConfirmed} className="input" value={props.selectedProjectId} onChange={(event) => props.setSelectedProjectId(event.target.value)}><option value="">请选择项目</option>{props.overview?.projects.map((project) => <option key={project.id} value={project.id}>{project.code} · {project.name} · {project.companyName}</option>)}</select></div> : <div className="context-grid"><div className="field"><label>项目名称 *</label><input disabled={props.workbook.contextConfirmed} className="input" value={props.projectName} onChange={(event) => props.setProjectName(event.target.value)} placeholder="例如：青岛鑫江中心" /></div><div className="field"><label>项目编号（可选）</label><input disabled={props.workbook.contextConfirmed} className="input" value={props.projectCode} onChange={(event) => props.setProjectCode(event.target.value)} placeholder="留空自动生成" /></div><div className="field"><label>所属公司（可后补）</label><select disabled={props.workbook.contextConfirmed} className="input" value={props.selectedCompanyId} onChange={(event) => props.setSelectedCompanyId(event.target.value)}><option value="">暂不绑定公司</option>{props.overview?.companies.map((company) => <option key={company.id} value={company.id}>{company.code} · {company.name}</option>)}</select></div></div>}</div> : props.scope === "COMPANY" ? <div className="context-form"><div className="context-mode"><label><input disabled={props.workbook.contextConfirmed} type="radio" checked={props.companyMode === "existing"} onChange={() => props.setCompanyMode("existing")} />选择公司</label>{props.isOwner ? <label><input disabled={props.workbook.contextConfirmed} type="radio" checked={props.companyMode === "new"} onChange={() => props.setCompanyMode("new")} />新建公司</label> : null}</div>{props.companyMode === "existing" ? <div className="field"><label>所属公司</label><select disabled={props.workbook.contextConfirmed} className="input" value={props.selectedCompanyId} onChange={(event) => props.setSelectedCompanyId(event.target.value)}><option value="">请选择公司</option>{props.overview?.companies.map((company) => <option key={company.id} value={company.id}>{company.code} · {company.name}</option>)}</select></div> : <div className="field"><label>公司名称 *</label><input disabled={props.workbook.contextConfirmed} className="input" value={props.companyName} onChange={(event) => props.setCompanyName(event.target.value)} /></div>}</div> : <div className="context-master-note"><Library /><span>公共主数据不绑定项目，供应商和客户仍保持共享主记录。</span></div>}<div className="migration-footer"><span>{props.workbook.analysis.projectCandidate ? `系统候选项目：${props.workbook.analysis.projectCandidate.name} · ${Math.round(props.workbook.analysis.projectCandidate.confidence / 100)}%` : "未从文件中提取到明确项目名称"}</span><button className="button primary" disabled={disabled} onClick={() => void props.confirmContext()}><CheckCircle2 />{props.workbook.contextConfirmed ? "归属已确认" : "确认归属并自动预检"}</button></div></section>;
}

function AnalysisPanel(props: { workbook: Workbook; facts: StoredFact[]; pendingFacts: StoredFact[]; projectLabel: string; selectedSheet: SheetInfo | null; loading: boolean; feedback: string; batchStatus: string; reviewFact: (id: number, decision: "ACCEPT" | "IGNORE") => Promise<void>; stage: () => Promise<void> }) {
  const displayFacts: Array<StoredFact | RecognizedBusinessFact> = props.facts.length ? props.facts : props.workbook.analysis.facts;
  return <section className="panel import-analysis-panel"><div className="panel-header"><div><div className="panel-title">3. 自动规则分析</div><div className="panel-subtitle">本地规则引擎，结果可复现；不调用大模型</div></div><span className={`badge ${props.workbook.analysis.overallConfidence >= 9000 ? "success" : "warning"}`}><Sparkles />规则置信度 {Math.round(props.workbook.analysis.overallConfidence / 100)}%</span></div><div className="analysis-summary"><div><span>目标作用域</span><strong>{scopeLabels[props.workbook.scope]}</strong></div><div><span>目标项目</span><strong>{props.projectLabel}</strong></div><div><span>高置信业务事实</span><strong>{props.workbook.analysis.highConfidenceCount}</strong></div><div><span>已识别图片</span><strong>{props.workbook.imageCount ?? 0}</strong></div></div><div className="fact-plan-list">{displayFacts.map((fact, index) => { const stored = "id" in fact ? fact : null; const label = stored?.payload.label ?? (fact as RecognizedBusinessFact).label ?? fact.factType; const count = stored?.payload.plannedCount ?? (fact as RecognizedBusinessFact).plannedCount ?? 1; const sheetName = stored?.payload.sheetName ?? (fact as RecognizedBusinessFact).sheetName; const level = (stored?.confidenceLevel ?? (fact as RecognizedBusinessFact).level) as ConfidenceLevel; const status = stored?.status ?? (level === "HIGH" ? "AUTO_ACCEPTED" : "REQUIRES_CONFIRMATION"); return <div className="fact-plan-row" key={stored?.id ?? `${fact.factType}-${index}`}><div><strong>{label}</strong><span>{sheetName} · 计划 {count} 项</span></div><span className={`badge ${factStatusTone(status, level)}`}>{factStatusLabel(status, level)}</span>{stored && status === "REQUIRES_CONFIRMATION" ? <div className="fact-actions"><button className="button small" disabled={props.loading} onClick={() => void props.reviewFact(stored.id, "IGNORE")}>只保留原表</button><button className="button small" disabled={props.loading} onClick={() => void props.reviewFact(stored.id, "ACCEPT")}>确认识别</button></div> : null}</div>; })}</div><div className="migration-footer"><span aria-live="polite">{props.feedback || (props.pendingFacts.length ? `还有 ${props.pendingFacts.length} 项异常需要处理` : "规则会合并全部产品 Sheet，并自动补齐项目、SKU 编码和图片")}</span><button className="button primary" disabled={props.loading || !props.selectedSheet || props.pendingFacts.length > 0} onClick={() => void props.stage()}>{props.loading ? <LoaderCircle className="animate-spin" /> : <RotateCcw />}{props.loading ? "规则预检中..." : props.batchStatus === "READY_TO_IMPORT" ? "重新规则预检（需再确认）" : "重新运行规则预检"}</button></div></section>;
}

function SheetPanel(props: { workbook: Workbook; selectedSheet: SheetInfo | null; setSelectedSheet: (sheet: SheetInfo) => void; setBusinessType: (value: string) => void; allowedTypes: string[] }) {
  return <section className="panel"><div className="panel-header"><div><div className="panel-title">4. Sheet 识别结果</div><div className="panel-subtitle">系统自动识别有效数据区和内嵌图片；点击 Sheet 可查看原表预览</div></div></div><div className="sheet-selector">{props.workbook.sheets.map((sheet) => <button key={sheet.id} className={props.selectedSheet?.id === sheet.id ? "active" : ""} onClick={() => { props.setSelectedSheet(sheet); const resource = sheet.recognizedFacts?.find((fact) => fact.resource && props.allowedTypes.includes(fact.resource))?.resource ?? classificationResources[sheet.classification ?? ""]; if (resource && props.allowedTypes.includes(resource)) props.setBusinessType(resource); }}><div><FileSpreadsheet /><strong>{sheet.name}</strong></div><span>{sheet.rowCount.toLocaleString("zh-CN")} 行 · {sheet.columnCount} 列{sheet.imageCount ? ` · ${sheet.imageCount} 张图` : ""}</span><small>{(sheet.recognizedFacts ?? []).map((fact) => fact.label).slice(0, 3).join(" / ") || classificationLabels[sheet.classification ?? "UNKNOWN"]} · {Math.round(Number(sheet.classificationConfidence ?? 0) / 100)}%</small>{sheet.matchedTemplate ? <small>已复用规则：{sheet.matchedTemplate.name}</small> : null}</button>)}</div>{props.selectedSheet?.classificationWarnings?.length ? <div className="migration-notice warning"><AlertTriangle />{props.selectedSheet.classificationWarnings.join("；")}</div> : null}{props.selectedSheet?.headers.length ? <div className="table-scroll"><table className="data-table migration-preview"><thead><tr>{props.selectedSheet.headers.map((header) => <th key={header}>{header}</th>)}</tr></thead><tbody>{props.selectedSheet.previewRows.map((row, index) => <tr key={index}>{props.selectedSheet!.headers.map((header) => { const value = String(row[header] ?? ""); return <td key={header}>{value.startsWith("/api/import-media/") ? <Image className="sku-thumb" src={value} alt="原表产品" width={48} height={48} unoptimized /> : value || "-"}</td>; })}</tr>)}</tbody></table></div> : null}</section>;
}

function StagingPanel(props: { detail: BatchDetail; fields: NonNullable<ReturnType<typeof migrationDefinition>>["fields"]; batchStatus: string; errorRows: number; pendingFacts: StoredFact[]; loading: boolean; feedback: string; resolutionsByRow: Map<number, Resolution[]>; loadBatch: (id: number, page?: number) => Promise<void>; updateRow: (id: number, payload: Record<string, unknown>) => Promise<void>; setEditRow: (row: StagingRow) => void; batchAction: (action: "confirm" | "import" | "rollback") => Promise<void> }) {
  return <section className="panel"><div className="panel-header"><div><div className="panel-title">5. 暂存区预览与人工确认</div><div className="panel-subtitle">第 {props.detail.page} 页，每页 {props.detail.pageSize} 行；项目上下文已锁定</div></div><div className="migration-counts"><span className="badge success">可导入 {String(batchValue(props.detail.batch, "readyRows", "ready_rows") ?? 0)}</span><span className="badge warning">警告 {String(batchValue(props.detail.batch, "warningRows", "warning_rows") ?? 0)}</span><span className="badge danger">错误 {String(batchValue(props.detail.batch, "errorRows", "error_rows") ?? 0)}</span>{props.detail.unresolvedReferences > 0 ? <span className="badge warning">待确认关联 {props.detail.unresolvedReferences}</span> : null}{props.errorRows > 0 ? <a className="button small" href={`/api/migrations/batches/${String(props.detail.batch.id)}/errors`}><Download />导出错误行</a> : null}</div></div><div className="table-scroll"><table className="data-table staging-table"><thead><tr><th>原始位置</th><th>标准化数据</th><th>关联 / 重复</th><th>状态</th><th>处理</th></tr></thead><tbody>{props.detail.rows.map((row) => <tr key={row.id}><td>{row.sheetName ? `${row.sheetName} · ` : ""}{row.sourceRow}</td><td>{row.normalizedData.imageUrl ? <Image className="sku-thumb" src={String(row.normalizedData.imageUrl)} alt="待导入产品" width={48} height={48} unoptimized /> : null}<div className="staging-values">{props.fields.slice(0, 4).map((field) => <span key={field.key}><small>{field.displayLabel}</small>{String(row.normalizedData[field.key] ?? "-")}</span>)}</div></td><td><div className="issue-list">{row.issues.length ? row.issues.slice(0, 3).map((issue, index) => <span className={issue.severity === "ERROR" ? "danger-text" : "warning-text"} key={`${issue.code}-${index}`}>{issue.message}</span>) : <span className="success-text">校验通过</span>}{(props.resolutionsByRow.get(row.id) ?? []).map((resolution) => resolution.candidates.length ? <select key={resolution.fieldKey} className="input compact" defaultValue="" onChange={(event) => event.target.value && void props.updateRow(row.id, { fieldKey: resolution.fieldKey, confirmedReferenceId: Number(event.target.value) })}><option value="">选择{resolution.inputValue}的匹配项</option>{resolution.candidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.code} · {candidate.name}</option>)}</select> : null)}</div></td><td><span className={`badge ${row.status === "ERROR" ? "danger" : row.status === "WARNING" ? "warning" : "success"}`}>{statusLabels[row.status] ?? row.status}</span></td><td><div className="row-actions"><button className="button small" onClick={() => props.setEditRow(row)}>编辑</button>{(row.duplicateStatus !== "NEW" || row.status === "ERROR") ? <select className="input compact" value={row.action} onChange={(event) => void props.updateRow(row.id, { action: event.target.value })}><option value="SKIP">跳过</option><option value="MATCH">匹配现有</option><option value="CREATE">作为新记录</option></select> : null}</div></td></tr>)}</tbody></table></div><div className="migration-footer"><div><button className="button small" disabled={props.detail.page <= 1 || props.loading} onClick={() => void props.loadBatch(Number(props.detail.batch.id), props.detail.page - 1)}><ArrowLeft />上一页</button><button className="button small" disabled={props.detail.rows.length < props.detail.pageSize || props.loading} onClick={() => void props.loadBatch(Number(props.detail.batch.id), props.detail.page + 1)}>下一页<ArrowRight /></button></div><span className="migration-action-feedback" aria-live="polite">{props.feedback || (props.batchStatus === "VALIDATED" ? "预检通过后先确认结果，再写入正式库" : props.batchStatus === "READY_TO_IMPORT" ? "确认已完成，可以正式导入" : "批次处理完成")}</span><div>{props.batchStatus === "VALIDATED" ? <button className="button" disabled={props.errorRows > 0 || props.detail.unresolvedReferences > 0 || props.pendingFacts.length > 0 || props.loading} onClick={() => void props.batchAction("confirm")}>{props.loading ? <LoaderCircle className="animate-spin" /> : <CheckCircle2 />}{props.loading ? "处理中..." : "确认预检结果"}</button> : null}{props.batchStatus === "READY_TO_IMPORT" ? <button className="button primary" disabled={props.loading} onClick={() => void props.batchAction("import")}>{props.loading ? <LoaderCircle className="animate-spin" /> : <Database />}{props.loading ? "正式写入中..." : "正式导入"}</button> : null}{props.batchStatus === "COMPLETED" ? <button className="button danger" disabled={props.loading} onClick={() => void props.batchAction("rollback")}><RotateCcw />撤销批次</button> : null}</div></div></section>;
}

function BatchResult({ batch }: { batch: Record<string, unknown> }) {
  if (batch.status === "COMPLETED" || batch.status === "ROLLED_BACK") return <><span className="success-text">{String(batch.successRows)}</span> / <span className="warning-text">{String(batch.skippedRows)}</span> / <span className="danger-text">{String(batch.errorRows)}</span></>;
  return <><span className="success-text">{String(batch.readyRows)} 可导入</span> / <span className="warning-text">{String(batch.warningRows)} 待确认</span> / <span className="danger-text">{String(batch.errorRows)} 错误</span></>;
}

function HistoryPanel({ overview, loadBatch }: { overview: Overview | null; loadBatch: (id: number) => Promise<void> }) {
  return <section className="panel"><div className="panel-header"><div><div className="panel-title">导入历史</div><div className="panel-subtitle">批次、项目作用域、来源、Hash 状态与结果统计</div></div><History /></div><div className="table-scroll"><table className="data-table"><thead><tr><th>批次</th><th>归属</th><th>来源</th><th>业务类型</th><th>总行数</th><th>结果</th><th>状态</th><th></th></tr></thead><tbody>{overview?.batches.map((batch) => <tr key={String(batch.id)}><td className="table-primary">{String(batch.batchNumber)}<div className="table-secondary">Hash {String(batch.sourceHash ?? "").slice(0, 10)}</div></td><td><span className="badge">{scopeLabels[String(batch.scopeType)] ?? String(batch.scopeType ?? "待确认")}</span><div>{String(batch.projectName ?? batch.projectCandidate ?? "-")}</div></td><td><span className="badge">{sourceChannelLabels[String(batch.sourceChannel)] ?? String(batch.sourceChannel ?? "-")}</span><div>{String(batch.filename ?? "-")}</div><div className="table-secondary">{String(batch.sheetName ?? "未选择 Sheet")}</div></td><td>{businessLabels[String(batch.businessType)] ?? String(batch.businessType ?? "自动识别")}</td><td>{String(batch.totalRows)}</td><td><BatchResult batch={batch} /></td><td><span className={`badge ${batch.status === "COMPLETED" ? "success" : batch.status === "ROLLED_BACK" || batch.status === "PROJECT_CONFLICT" ? "danger" : "warning"}`}>{statusLabels[String(batch.status)] ?? String(batch.status)}</span></td><td><button className="button small" onClick={() => void loadBatch(Number(batch.id))}>查看</button></td></tr>)}</tbody></table></div></section>;
}

function EditStagingModal({ row, fields, onClose, onSave }: { row: StagingRow; fields: NonNullable<ReturnType<typeof migrationDefinition>>["fields"]; onClose: () => void; onSave: (updates: Record<string, unknown>) => void }) {
  const [values, setValues] = useState<Record<string, unknown>>(() => Object.fromEntries(fields.map((field) => [field.key, row.normalizedData[field.key] ?? ""])));
  return <div className="modal-backdrop"><div className="modal"><div className="modal-header"><div className="modal-title">修改暂存数据 · 原始行 {row.sourceRow}</div><button className="icon-plain" onClick={onClose}>×</button></div><div className="form-grid">{fields.map((field) => <div className="field" key={field.key}><label>{field.displayLabel}{field.required ? <span className="required">*</span> : null}</label><input className="input" type={field.type === "number" ? "number" : field.type === "date" ? "date" : "text"} value={String(values[field.key] ?? "")} onChange={(event) => setValues((current) => ({ ...current, [field.key]: field.type === "number" ? Number(event.target.value) : event.target.value }))} /></div>)}</div><div className="modal-footer"><button className="button" onClick={onClose}>取消</button><button className="button primary" onClick={() => onSave(values)}><Save />保存并复检</button></div></div></div>;
}

function AssignProjectCompanyModal(props: { projectName: string; rowCount: number; companies: CompanyOption[]; companyId: string; setCompanyId: (value: string) => void; loading: boolean; onClose: () => void; onConfirm: () => Promise<void> }) {
  return <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="assign-company-title"><div className="modal compact-modal"><div className="modal-header"><div><div className="modal-title" id="assign-company-title">补充项目所属公司</div><div className="panel-subtitle">项目“{props.projectName}”尚未归属公司，正式业务记录必须有核算主体。</div></div><button className="icon-plain" aria-label="关闭" disabled={props.loading} onClick={props.onClose}>×</button></div><div className="company-assignment-body"><div className="migration-notice warning"><AlertTriangle />选择后会更新项目归属，并立即导入当前已确认的 {props.rowCount} 条预检数据。</div><div className="field"><label htmlFor="import-company">所属公司 *</label><select id="import-company" className="input" value={props.companyId} disabled={props.loading} onChange={(event) => props.setCompanyId(event.target.value)}><option value="">请选择公司</option>{props.companies.map((company) => <option key={company.id} value={company.id}>{company.code} · {company.name}</option>)}</select></div></div><div className="modal-footer"><button className="button" disabled={props.loading} onClick={props.onClose}>取消</button><button className="button primary" disabled={props.loading || !props.companyId} onClick={() => void props.onConfirm()}>{props.loading ? <LoaderCircle className="animate-spin" /> : <Database />}{props.loading ? "正在导入..." : "绑定公司并正式导入"}</button></div></div></div>;
}
