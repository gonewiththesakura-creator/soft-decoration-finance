import { createHash } from "node:crypto";
import { sqlQuery } from "@/db/client";
import type { SessionUser } from "@/lib/auth";
import { RealDataIngestError } from "@/lib/real-data-ingest";
import { createMigrationWorkbook, resolveProjectForImport, sanitizeImportFilename } from "./data-migration";
import type { ImportScope } from "./import-intelligence";
import { parseWorkbook } from "./import-pilot";

type StoredResponse = { payload: Record<string, unknown>; status: number };

function jsonObject(value: unknown) {
  if (value && typeof value === "object") return value as Record<string, unknown>;
  if (typeof value === "string") {
    try { return JSON.parse(value) as Record<string, unknown>; } catch { return {}; }
  }
  return {};
}

async function externalOwner(): Promise<SessionUser> {
  const [owner] = await sqlQuery<SessionUser & { status: string }>(`SELECT id,company_id AS "companyId",name,email,role,status FROM users WHERE role='owner' AND status='active' ORDER BY id LIMIT 1`);
  if (!owner) throw new RealDataIngestError("OWNER_NOT_AVAILABLE", 503, "系统中没有可用的 Owner 管理员");
  return { id: Number(owner.id), companyId: owner.companyId === null ? null : Number(owner.companyId), name: owner.name, email: owner.email, role: owner.role };
}

export async function getExternalIngestReplay(idempotencyKey: string | null): Promise<StoredResponse | null> {
  if (!idempotencyKey) return null;
  const [request] = await sqlQuery<{ status: string; httpStatus: number | null; response: unknown }>(`SELECT status,http_status AS "httpStatus",response FROM real_data_ingest_requests WHERE idempotency_key=$1`, [idempotencyKey]);
  if (!request) return null;
  if (request.status === "PROCESSING") throw new RealDataIngestError("IDEMPOTENCY_IN_PROGRESS", 409, "该 Idempotency-Key 的请求仍在处理中");
  return { payload: jsonObject(request.response), status: Number(request.httpStatus ?? 500) };
}

async function beginSubmission(input: { idempotencyKey: string | null; remoteIp: string; fileCount: number; totalBytes: number }) {
  const [created] = await sqlQuery<{ id: number }>(`INSERT INTO real_data_ingest_requests(idempotency_key,remote_ip,received_files,total_bytes) VALUES($1,$2,$3,$4) ON CONFLICT(idempotency_key) DO NOTHING RETURNING id`, [input.idempotencyKey, input.remoteIp, input.fileCount, input.totalBytes]);
  if (created) return Number(created.id);
  const replay = await getExternalIngestReplay(input.idempotencyKey);
  if (replay) return replay;
  throw new RealDataIngestError("IDEMPOTENCY_IN_PROGRESS", 409, "该 Idempotency-Key 的请求仍在处理中");
}

async function completeSubmission(requestId: number, status: "COMPLETED" | "FAILED", httpStatus: number, payload: Record<string, unknown>) {
  await sqlQuery(`UPDATE real_data_ingest_requests SET status=$1,http_status=$2,response=$3::jsonb,completed_at=now() WHERE id=$4`, [status, httpStatus, JSON.stringify(payload), requestId]);
}

async function writeIngestAudit(input: { requestId: number; batchId?: number | null; remoteIp: string; filename: string; fileSize: number; sha256?: string | null; result: string; idempotencyKey: string | null }) {
  await sqlQuery(`INSERT INTO real_data_ingest_audit(request_id,batch_id,remote_ip,filename,file_size,sha256,result,idempotency_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [input.requestId, input.batchId ?? null, input.remoteIp, input.filename, input.fileSize, input.sha256 ?? null, input.result, input.idempotencyKey]);
}

export async function ingestExternalFiles(files: File[], input: { idempotencyKey: string | null; remoteIp: string; totalBytes: number; scope?: ImportScope; projectId?: number | null; projectName?: string; projectCode?: string; createProject?: boolean; companyId?: number | null }): Promise<StoredResponse> {
  const started = await beginSubmission({ ...input, fileCount: files.length });
  if (typeof started !== "number") return started;
  const requestId = started;
  const prepared: { file: File; filename: string; sha256: string; valid: boolean }[] = [];
  let invalid = false;

  for (const file of files) {
    const filename = sanitizeImportFilename(file.name);
    const bytes = Buffer.from(await file.arrayBuffer());
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    let valid = true;
    try { parseWorkbook(bytes, filename); }
    catch { valid = false; invalid = true; }
    prepared.push({ file, filename, sha256, valid });
  }

  if (invalid) {
    const payload = { ok: false, error: "INVALID_FILE", message: "至少一个文件无法作为有效的 Excel 或 CSV 解析" };
    await Promise.all(prepared.map((item) => writeIngestAudit({ requestId, remoteIp: input.remoteIp, filename: item.filename, fileSize: item.file.size, sha256: item.sha256, result: item.valid ? "REJECTED_REQUEST" : "REJECTED_INVALID_FILE", idempotencyKey: input.idempotencyKey })));
    await completeSubmission(requestId, "FAILED", 400, payload);
    return { payload, status: 400 };
  }

  const owner = await externalOwner();
  let project: Awaited<ReturnType<typeof resolveProjectForImport>> | null = null;
  if (input.scope === "PROJECT") {
    try { project = await resolveProjectForImport(input, owner); }
    catch (error) {
      const code = error instanceof Error ? error.message : "PROJECT_CONTEXT_REQUIRED";
      const payload = { ok: false, error: code, message: code === "PROJECT_NOT_FOUND" ? "目标项目不存在，请传入有效 projectId，或使用 projectName + createProject=true" : "项目数据必须提供 projectId 或 projectName" };
      await completeSubmission(requestId, "FAILED", 400, payload);
      return { payload, status: 400 };
    }
  }
  const batches: Record<string, unknown>[] = [];
  try {
    for (const item of prepared) {
      const workbook = await createMigrationWorkbook(item.file, owner, { channel: "EXTERNAL_API", scope: input.scope ?? "PENDING", projectId: project?.id ?? null, companyId: project?.companyId ?? input.companyId ?? null });
      const fingerprintStatus = ["DUPLICATE", "UNCHANGED"].includes(workbook.fingerprintStatus) ? "UNCHANGED" : workbook.fingerprintStatus;
      batches.push({
        batchId: workbook.batchId,
        batchNumber: workbook.batchNumber,
        filename: workbook.filename,
        sha256: item.sha256,
        fingerprintStatus,
        duplicateOfBatchId: workbook.duplicateOfBatchId,
        versionNumber: workbook.versionNumber,
        sheetCount: workbook.sheetCount,
        scope: workbook.scope,
        projectId: workbook.projectId,
        projectName: project?.name ?? null,
        projectConflict: workbook.projectConflict,
        analysis: workbook.analysis,
        sheets: workbook.sheets.map((sheet) => ({ name: sheet.name, classification: sheet.classification, rowCount: sheet.rowCount, confidence: Math.round(sheet.classificationConfidence / 100) })),
        status: workbook.projectConflict ? "PROJECT_CONFLICT" : "UPLOADED",
        next: "REVIEW_IN_IMPORT_CENTER",
      });
      await writeIngestAudit({ requestId, batchId: workbook.batchId, remoteIp: input.remoteIp, filename: workbook.filename, fileSize: item.file.size, sha256: item.sha256, result: "STAGED", idempotencyKey: input.idempotencyKey });
    }
  } catch {
    const processed = new Set(batches.map((batch) => String(batch.sha256)));
    await Promise.all(prepared.filter((item) => !processed.has(item.sha256)).map((item) => writeIngestAudit({ requestId, remoteIp: input.remoteIp, filename: item.filename, fileSize: item.file.size, sha256: item.sha256, result: "FAILED", idempotencyKey: input.idempotencyKey })));
    const payload = { ok: false, error: "INGEST_FAILED", message: "文件解析或暂存失败" };
    await completeSubmission(requestId, "FAILED", 400, payload);
    return { payload, status: 400 };
  }

  const payload = { ok: true, dataMode: "real", scope: input.scope ?? "PENDING", project: project ? { id: project.id, name: project.name, code: project.code, created: project.created } : null, received: files.length, batches };
  await completeSubmission(requestId, "COMPLETED", 200, payload);
  return { payload, status: 200 };
}

const businessTables = [
  "companies", "company_accounts", "customers", "suppliers", "projects", "project_members", "project_budget_versions",
  "project_changes", "contracts", "receivable_plans", "receipts", "skus", "supplier_quotes", "purchase_requests",
  "purchase_request_items", "purchase_approvals", "purchase_orders", "goods_receipts", "purchase_returns", "payables",
  "payment_requests", "payment_approvals", "payments", "invoices", "invoice_allocations", "inventory_batches",
  "inventory_transactions", "shareholder_advances",
] as const;

export async function getRealDataIngestStatus() {
  const fields = businessTables.map((table) => `(SELECT count(*)::int FROM ${table}) AS "${table}"`).join(",");
  const [counts] = await sqlQuery<Record<string, number>>(`SELECT ${fields}`);
  return {
    ok: true,
    dataMode: "real",
    businessDataEmpty: Object.values(counts).every((count) => Number(count) === 0),
    counts: {
      companies: Number(counts.companies),
      projects: Number(counts.projects),
      suppliers: Number(counts.suppliers),
      customers: Number(counts.customers),
      skus: Number(counts.skus),
    },
  };
}

export async function getExternalIngestBatch(batchId: number) {
  const [batch] = await sqlQuery<Record<string, unknown>>(`SELECT b.id,b.batch_number AS "batchNumber",b.status,b.source_channel AS "sourceChannel",b.scope_type AS scope,b.project_id AS "projectId",p.name AS "projectName",b.context_confirmed AS "contextConfirmed",b.project_candidate AS "projectCandidate",b.project_conflict AS "projectConflict",b.analysis_summary AS analysis,b.business_type AS "businessType",b.mapping_template_id AS "mappingTemplateId",b.total_rows AS "totalRows",b.ready_rows AS "readyRows",b.warning_rows AS "warningRows",b.error_rows AS "errorRows",b.success_rows AS "successRows",b.skipped_rows AS "skippedRows",b.created_at AS "createdAt",b.completed_at AS "completedAt",f.filename,f.file_hash AS "sha256",f.fingerprint_status AS "fingerprintStatus",f.version_number AS "versionNumber" FROM import_batches b JOIN import_files f ON f.batch_id=b.id LEFT JOIN projects p ON p.id=b.project_id WHERE b.id=$1 AND b.source_channel='EXTERNAL_API'`, [batchId]);
  if (!batch) throw new RealDataIngestError("BATCH_NOT_FOUND", 404, "外部导入批次不存在");
  const sheets = await sqlQuery<Record<string, unknown>>(`SELECT name,classification,row_count AS "rowCount",classification_confidence AS "classificationConfidence",recognized_facts AS "recognizedFacts",analysis_confidence AS "analysisConfidence",selected FROM import_sheets WHERE batch_id=$1 ORDER BY sheet_index`, [batchId]);
  const facts = await sqlQuery<Record<string, unknown>>(`SELECT id,fact_type AS "factType",confidence,confidence_level AS "confidenceLevel",status FROM import_business_facts WHERE batch_id=$1 AND fact_type<>'COST_ITEM' ORDER BY confidence DESC,id LIMIT 100`, [batchId]);
  return {
    ok: true,
    batch: {
      ...batch,
      imported: batch.status === "COMPLETED",
      stagingStatus: batch.status,
      facts,
      sheets: sheets.map((sheet) => ({ name: sheet.name, classification: sheet.classification, rowCount: Number(sheet.rowCount), confidence: Math.round(Number(sheet.analysisConfidence ?? sheet.classificationConfidence) / 100), recognizedFacts: sheet.recognizedFacts, selected: Boolean(sheet.selected) })),
    },
  };
}
