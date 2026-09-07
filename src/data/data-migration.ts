import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, extname, resolve, sep } from "node:path";
import * as XLSX from "xlsx";
import { runTransaction, sqlQuery, type TransactionStatement } from "@/db/client";
import type { SessionUser } from "@/lib/auth";
import { assertProjectAccess } from "@/lib/access";
import { IMPORT_MAX_FILE_BYTES, IMPORT_MAX_FILE_MB } from "@/lib/import-limits";
import { assertCan, type ResourceKey } from "@/lib/permissions";
import { isRealDataMode } from "@/lib/data-mode";
import { importRowsAtomic, preflightImport, type MigrationLineageInput } from "./excel-import";
import {
  applyFieldMapping, duplicateRules, migrationDefinition, normalizeHeader, parseAmount, parseQuantity, sheetSignature, suggestFieldMappings,
  validateMigrationRow, type MigrationIssue, type ReferenceEntity,
} from "./data-migration-rules";
import { buildBusinessFacts, parseWorkbook, sourceGroupKey, type FingerprintStatus } from "./import-pilot";
import { extractWorkbookImages } from "./excel-images";
import {
  analyzeWorkbook, detectProjectConflict, extractProjectCandidate, projectNamesEquivalent, type ImportScope, type IntelligentWorkbookAnalysis,
} from "./import-intelligence";

export type ImportSourceChannel = "UPLOAD_UI" | "FOLDER" | "EXTERNAL_API";

export function sanitizeImportFilename(filename: string) {
  const base = basename(filename.replaceAll("\\", "/")).normalize("NFKC");
  const extension = extname(base).toLowerCase();
  const stem = base.slice(0, Math.max(0, base.length - extension.length)).replace(/[^\p{L}\p{N}._-]+/gu, "_").replace(/^\.+|\.+$/g, "").slice(0, 160);
  return `${stem || "import"}${extension}`;
}

type Candidate = { id: number; companyId: number | null; name: string; code: string; aliases: string[] };
export type ResolutionStatus = "EXACT_MATCH" | "POSSIBLE_MATCH" | "NOT_FOUND" | "MULTIPLE_MATCHES";
type Resolution = { fieldKey: string; entityType: ReferenceEntity; inputValue: string; status: ResolutionStatus; resolvedEntityId: number | null; candidates: Candidate[] };

const entityQueries: Record<ReferenceEntity, string> = {
  company: `SELECT id,id AS "companyId",name,code FROM companies WHERE status='active'`,
  customer: `SELECT id,company_id AS "companyId",name,code FROM customers WHERE status='active'`,
  project: `SELECT id,company_id AS "companyId",name,code FROM projects`,
  supplier: `SELECT id,company_id AS "companyId",name,code FROM suppliers WHERE status='active'`,
  sku: `SELECT id,company_id AS "companyId",name,code FROM skus`,
  contract: `SELECT id,company_id AS "companyId",name,number AS code FROM contracts WHERE NOT is_void`,
  account: `SELECT id,company_id AS "companyId",name,COALESCE(last_four,'') AS code FROM company_accounts WHERE status='active'`,
  receivable: `SELECT r.id,r.company_id AS "companyId",r.node_name AS name,c.number||' / '||r.node_name AS code FROM receivable_plans r JOIN contracts c ON c.id=r.contract_id WHERE NOT r.is_void`,
  purchase_order: `SELECT id,company_id AS "companyId",number AS name,number AS code FROM purchase_orders WHERE NOT is_void`,
  payable: `SELECT id,company_id AS "companyId",number AS name,number AS code FROM payables WHERE NOT is_void`,
};

const entitySuffix = /(有限责任公司|股份有限公司|有限公司|公司)$/;
function entityKey(value: unknown) { return normalizeHeader(value).replace(entitySuffix, ""); }
function jsonValue<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "string") { try { return JSON.parse(value) as T; } catch { return fallback; } }
  return value as T;
}
function scopeAllowed(user: SessionUser, companyId: number | null) { return user.role === "owner" || (companyId !== null && companyId === user.companyId); }
async function requireBatch(batchId: number, user: SessionUser) {
  const [batch] = await sqlQuery<Record<string, unknown>>(`SELECT * FROM import_batches WHERE id=$1`, [batchId]);
  if (!batch) throw new Error("批次不存在或超出公司权限范围");
  if (user.role !== "owner" && batch.project_id) {
    try { await assertProjectAccess(user, Number(batch.project_id)); }
    catch { throw new Error("批次不存在或超出公司权限范围"); }
  } else if (!scopeAllowed(user, batch.company_id === null ? null : Number(batch.company_id))) throw new Error("批次不存在或超出公司权限范围");
  return batch;
}

async function loadCatalog(user: SessionUser) {
  const entries = await Promise.all(Object.entries(entityQueries).map(async ([entity, query]) => [entity, await sqlQuery<Omit<Candidate, "aliases">>(query)] as const));
  const aliases = await sqlQuery<{ entityType: ReferenceEntity; entityId: number; alias: string; companyId: number }>(`SELECT entity_type AS "entityType",entity_id AS "entityId",alias,company_id AS "companyId" FROM entity_aliases`);
  return Object.fromEntries(entries.map(([entity, rows]) => [entity, rows.filter((row) => scopeAllowed(user, row.companyId === null ? null : Number(row.companyId))).map((row) => ({ ...row, id: Number(row.id), companyId: row.companyId === null ? null : Number(row.companyId), aliases: aliases.filter((alias) => alias.entityType === entity && Number(alias.entityId) === Number(row.id)).map((alias) => alias.alias) }))])) as Record<ReferenceEntity, Candidate[]>;
}

export function resolveReference(entityType: ReferenceEntity, inputValue: string, candidates: Candidate[], companyId: number | null): Resolution {
  const available = candidates.filter((candidate) => companyId === null || candidate.companyId === companyId || entityType === "company");
  const key = normalizeHeader(inputValue); const canonical = entityKey(inputValue);
  const exact = available.filter((candidate) => [candidate.name, candidate.code, ...candidate.aliases].some((value) => normalizeHeader(value) === key));
  if (exact.length === 1) return { fieldKey: "", entityType, inputValue, status: "EXACT_MATCH", resolvedEntityId: exact[0].id, candidates: exact };
  if (exact.length > 1) return { fieldKey: "", entityType, inputValue, status: "MULTIPLE_MATCHES", resolvedEntityId: null, candidates: exact.slice(0, 8) };
  const possible = available.filter((candidate) => [candidate.name, candidate.code, ...candidate.aliases].some((value) => {
    const candidateKey = entityKey(value); return canonical.length >= 2 && (candidateKey === canonical || candidateKey.includes(canonical) || canonical.includes(candidateKey));
  }));
  if (possible.length === 1) return { fieldKey: "", entityType, inputValue, status: "POSSIBLE_MATCH", resolvedEntityId: possible[0].id, candidates: possible };
  if (possible.length > 1) return { fieldKey: "", entityType, inputValue, status: "MULTIPLE_MATCHES", resolvedEntityId: null, candidates: possible.slice(0, 8) };
  return { fieldKey: "", entityType, inputValue, status: "NOT_FOUND", resolvedEntityId: null, candidates: [] };
}

export async function resolveStandardImportReferences(resource: ResourceKey, rows: Record<string, unknown>[], user: SessionUser) {
  const definition = migrationDefinition(resource); if (!definition) return { rows, errors: [{ row: 0, field: "类型", message: "不支持的导入类型" }] };
  const catalog = await loadCatalog(user); const errors: { row: number; field: string; message: string }[] = [];
  const resolvedRows = rows.map((source, index) => {
    const row = { ...source }; let companyId = user.companyId;
    for (const field of definition.fields.filter((item) => item.reference === "company")) {
      const resolution = resolveReference("company", String(row[field.key] ?? ""), catalog.company, null);
      if (resolution.status === "EXACT_MATCH" && resolution.resolvedEntityId) { row[field.key] = resolution.resolvedEntityId; companyId = resolution.resolvedEntityId; }
      else errors.push({ row: index + 2, field: field.displayLabel, message: "公司名称或编码未能唯一匹配" });
    }
    for (const field of definition.fields.filter((item) => item.reference && item.reference !== "company")) {
      const value = String(row[field.key] ?? ""); if (!value && !field.required) continue;
      const resolution = resolveReference(field.reference!, value, catalog[field.reference!], companyId);
      if (resolution.status === "EXACT_MATCH" && resolution.resolvedEntityId) { row[field.key] = resolution.resolvedEntityId; companyId ??= resolution.candidates[0]?.companyId ?? null; }
      else errors.push({ row: index + 2, field: field.displayLabel, message: "名称或编码未能唯一匹配" });
    }
    return row;
  });
  return { rows: resolvedRows, errors };
}

async function nextBatchNumber() {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()).replaceAll("-", "");
  const [row] = await sqlQuery<{ count: number }>(`SELECT count(*)::int AS count FROM import_batches WHERE batch_number LIKE $1`, [`IMP-${day}-%`]);
  return `IMP-${day}-${String(Number(row.count) + 1).padStart(4, "0")}`;
}

async function nextImportCode(table: "projects" | "companies", prefix: "PRJ" | "COM") {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()).replaceAll("-", "");
  const [row] = await sqlQuery<{ count: number }>(`SELECT count(*)::int AS count FROM ${table} WHERE code LIKE $1`, [`${prefix}-${day}-%`]);
  return `${prefix}-${day}-${String(Number(row.count) + 1).padStart(4, "0")}`;
}

export type ImportProjectContextInput = {
  projectId?: number | null;
  projectName?: string;
  projectCode?: string;
  companyId?: number | null;
  createProject?: boolean;
};

export async function resolveProjectForImport(input: ImportProjectContextInput, user: SessionUser) {
  if (input.projectId) {
    await assertProjectAccess(user, Number(input.projectId));
    const [project] = await sqlQuery<{ id: number; name: string; code: string; companyId: number | null }>(`SELECT id,name,code,company_id AS "companyId" FROM projects WHERE id=$1`, [input.projectId]);
    if (!project) throw new Error("PROJECT_NOT_FOUND");
    return { ...project, id: Number(project.id), companyId: project.companyId === null ? null : Number(project.companyId), created: false };
  }
  const projectName = String(input.projectName ?? "").trim();
  if (!projectName) throw new Error("PROJECT_CONTEXT_REQUIRED");
  const params: unknown[] = [];
  const conditions = ["TRUE"];
  if (user.role !== "owner") { params.push(user.companyId); conditions.push(`p.company_id IS NOT DISTINCT FROM $${params.length}`); }
  if (["project_manager", "designer"].includes(user.role)) { params.push(user.id); conditions.push(`EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id=p.id AND pm.user_id=$${params.length})`); }
  const projects = await sqlQuery<{ id: number; name: string; code: string; companyId: number | null }>(`SELECT p.id,p.name,p.code,p.company_id AS "companyId" FROM projects p WHERE ${conditions.join(" AND ")} ORDER BY p.id`, params);
  const existing = projects.find((project) => projectNamesEquivalent(project.name, projectName));
  if (existing) return { ...existing, id: Number(existing.id), companyId: existing.companyId === null ? null : Number(existing.companyId), created: false };
  if (!input.createProject) throw new Error("PROJECT_NOT_FOUND");
  assertCan(user, "projects", "write");
  const companyId = input.companyId ?? user.companyId;
  if (companyId !== null && companyId !== undefined) {
    if (user.role !== "owner" && Number(companyId) !== user.companyId) throw new Error("FORBIDDEN");
    const [company] = await sqlQuery<{ id: number }>(`SELECT id FROM companies WHERE id=$1 AND status='active'`, [companyId]);
    if (!company) throw new Error("公司不存在或不可用");
  }
  const code = String(input.projectCode ?? "").trim() || await nextImportCode("projects", "PRJ");
  const statements: TransactionStatement[] = [{
    query: `INSERT INTO projects(company_id,customer_id,code,name,owner_id,manager_id,status,created_by) VALUES($1,NULL,$2,$3,$4,$5,'待补充',$4) RETURNING id,name,code,company_id AS "companyId"`,
    params: [companyId ?? null, code, projectName, user.id, user.role === "project_manager" ? user.id : null],
  }];
  if (user.role === "project_manager") statements.push({ query: `INSERT INTO project_members(project_id,user_id,responsibility,created_by) VALUES($1,$2,'项目导入',$2) ON CONFLICT(project_id,user_id) DO NOTHING`, params: [{ fromResult: 0, key: "id" }, user.id] });
  statements.push({ query: `INSERT INTO audit_logs(company_id,project_id,user_id,object_type,object_id,action,after,ip) VALUES($1,$2,$3,'project',$2,'CREATE_FROM_IMPORT',jsonb_build_object('name',$4::text),'127.0.0.1')`, params: [companyId ?? null, { fromResult: 0, key: "id" }, user.id, projectName] });
  const results = await runTransaction<{ id: number; name: string; code: string; companyId: number | null }>(statements);
  const project = results[0][0];
  return { ...project, id: Number(project.id), companyId: project.companyId === null ? null : Number(project.companyId), created: true };
}

async function resolveCompanyForImport(input: { companyId?: number | null; companyName?: string; createCompany?: boolean }, user: SessionUser) {
  if (input.companyId) {
    if (user.role !== "owner" && input.companyId !== user.companyId) throw new Error("FORBIDDEN");
    const [company] = await sqlQuery<{ id: number; name: string; code: string }>(`SELECT id,name,code FROM companies WHERE id=$1 AND status='active'`, [input.companyId]);
    if (!company) throw new Error("公司不存在或不可用");
    return { ...company, id: Number(company.id), created: false };
  }
  const name = String(input.companyName ?? "").trim();
  if (!name) throw new Error("COMPANY_CONTEXT_REQUIRED");
  const companies = await sqlQuery<{ id: number; name: string; code: string }>(`SELECT id,name,code FROM companies WHERE status='active' ORDER BY id`);
  const existing = companies.find((company) => normalizeHeader(company.name) === normalizeHeader(name));
  if (existing) {
    if (user.role !== "owner" && existing.id !== user.companyId) throw new Error("FORBIDDEN");
    return { ...existing, id: Number(existing.id), created: false };
  }
  if (!input.createCompany) throw new Error("COMPANY_NOT_FOUND");
  assertCan(user, "companies", "write");
  const code = await nextImportCode("companies", "COM");
  const [created] = await sqlQuery<{ id: number; name: string; code: string }>(`INSERT INTO companies(code,name,legal_representative,created_by) VALUES($1,$2,'',$3) RETURNING id,name,code`, [code, name, user.id]);
  return { ...created, id: Number(created.id), created: true };
}

export async function getImportContextOptions(user: SessionUser) {
  assertCan(user, "imports");
  const companyParams: unknown[] = []; const companyWhere = user.role === "owner" ? "status='active'" : `id=$${companyParams.push(user.companyId)} AND status='active'`;
  const projectParams: unknown[] = []; const projectConditions = ["TRUE"];
  if (user.role !== "owner") { projectParams.push(user.companyId); projectConditions.push(`p.company_id IS NOT DISTINCT FROM $${projectParams.length}`); }
  if (["project_manager", "designer"].includes(user.role)) { projectParams.push(user.id); projectConditions.push(`EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id=p.id AND pm.user_id=$${projectParams.length})`); }
  const [companies, projects] = await Promise.all([
    sqlQuery<{ id: number; name: string; code: string }>(`SELECT id,name,code FROM companies WHERE ${companyWhere} ORDER BY name`, companyParams),
    sqlQuery<{ id: number; name: string; code: string; companyId: number | null; companyName: string }>(`SELECT p.id,p.name,p.code,p.company_id AS "companyId",COALESCE(c.name,'待补充公司') AS "companyName" FROM projects p LEFT JOIN companies c ON c.id=p.company_id WHERE ${projectConditions.join(" AND ")} ORDER BY p.updated_at DESC,p.id DESC`, projectParams),
  ]);
  return { companies, projects: projects.map((project) => ({ ...project, id: Number(project.id), companyId: project.companyId === null ? null : Number(project.companyId) })) };
}

export async function createMigrationWorkbook(file: File, user: SessionUser, options: { channel?: ImportSourceChannel; sourcePath?: string; modifiedAt?: Date; scope?: ImportScope; projectId?: number | null; companyId?: number | null } = {}) {
  assertCan(user, "imports", "write");
  const filename = sanitizeImportFilename(file.name);
  if (!/\.(xlsx|xls|csv)$/i.test(filename)) throw new Error("仅支持 .xlsx / .xls / .csv 文件");
  if (!file.size) throw new Error("迁移文件不能为空");
  if (file.size > IMPORT_MAX_FILE_BYTES) throw new Error(`历史迁移文件不能超过 ${IMPORT_MAX_FILE_MB}MB`);
  const bytes = Buffer.from(await file.arrayBuffer()); const fileHash = createHash("sha256").update(bytes).digest("hex");
  const embeddedImages = extractWorkbookImages(bytes, filename);
  let sheets = parseWorkbook(bytes, filename).map((sheet) => ({ ...sheet, imageCount: embeddedImages.filter((image) => image.sheetIndex === sheet.index).length, signature: sheetSignature(sheet.headers) }));
  const analysis = analyzeWorkbook(filename, sheets, options.sourcePath);
  const scope = options.scope ?? "PENDING";
  if (scope === "PROJECT" && !options.projectId) throw new Error("PROJECT_CONTEXT_REQUIRED");
  if (scope === "COMPANY" && !options.companyId && !user.companyId) throw new Error("COMPANY_CONTEXT_REQUIRED");
  let project: { id: number; name: string; companyId: number | null } | null = null;
  if (options.projectId) {
    await assertProjectAccess(user, Number(options.projectId));
    [project] = await sqlQuery<{ id: number; name: string; companyId: number | null }>(`SELECT id,name,company_id AS "companyId" FROM projects WHERE id=$1`, [options.projectId]);
    if (!project) throw new Error("PROJECT_NOT_FOUND");
  }
  const projectId = project ? Number(project.id) : null;
  const companyId = project?.companyId === null ? null : Number(project?.companyId ?? options.companyId ?? user.companyId) || null;
  if (user.role !== "owner" && companyId !== null && companyId !== user.companyId) throw new Error("FORBIDDEN");
  const projectConflict = project ? detectProjectConflict(project.name, analysis.projectCandidate) : null;
  const contextConfirmed = scope !== "PENDING" && (scope !== "PROJECT" || Boolean(projectId)) && !projectConflict;
  const baseFacts = buildBusinessFacts(sheets).map((fact) => ({ ...fact, confidence: 9000, confidenceLevel: "HIGH", status: "AUTO_ACCEPTED" }));
  const recognizedFacts = analysis.facts.map((fact) => ({
    factType: fact.factType,
    businessKey: `SHEET:${fact.sheetIndex}:${fact.factType}`,
    payload: { label: fact.label, resource: fact.resource, plannedCount: fact.plannedCount, sheetName: fact.sheetName, mappings: fact.mappings, warnings: fact.warnings },
    confidence: fact.confidence,
    confidenceLevel: fact.level,
    status: projectConflict ? "CONFLICT" : fact.level === "HIGH" ? "AUTO_ACCEPTED" : "REQUIRES_CONFIRMATION",
    evidence: [{ sheetIndex: fact.sheetIndex, sourceRow: Number(sheets[fact.sheetIndex]?.rows[0]?.__sourceRow ?? sheets[fact.sheetIndex]?.headerRow ?? 1), sourceColumn: null, sourceCell: null, role: "PRIMARY" as const, rawValue: fact.sheetName }],
  }));
  const facts = [...baseFacts, ...recognizedFacts];
  const batchNumber = await nextBatchNumber();
  const imageMetadata = embeddedImages.map((image) => ({
    sheetIndex: image.sheetIndex,
    sourceRow: image.sourceRow,
    sourceColumn: image.sourceColumn,
    filename: image.filename,
    mimeType: image.mimeType,
    fileSize: image.bytes.byteLength,
    url: `/api/import-media/${encodeURIComponent(batchNumber)}/${encodeURIComponent(image.filename)}`,
  }));
  sheets = sheets.map((sheet) => {
    const sheetImages = imageMetadata.filter((image) => image.sheetIndex === sheet.index);
    const rows = sheet.rows.map((row) => {
      const rowImages = sheetImages.filter((image) => image.sourceRow === Number(row.__sourceRow));
      if (!rowImages.length) return row;
      const firstImage = rowImages[0];
      const imageHeader = sheet.headers[firstImage.sourceColumn - 1];
      return {
        ...row,
        ...(imageHeader && !String(row[imageHeader] ?? "").trim() ? { [imageHeader]: firstImage.url } : {}),
        __imageUrl: firstImage.url,
        __imageUrls: rowImages.map((image) => image.url),
      };
    });
    return { ...sheet, rows, previewRows: rows.slice(0, 50), images: sheetImages };
  });
  const groupKey = sourceGroupKey(filename) || fileHash;
  const [sourceGroup] = await sqlQuery<{ id: number }>(`INSERT INTO import_source_groups(group_key,project_hint) VALUES($1,$2) ON CONFLICT(group_key) DO UPDATE SET project_hint=COALESCE(EXCLUDED.project_hint,import_source_groups.project_hint),last_seen_at=now() RETURNING id`, [groupKey, analysis.projectCandidate?.name ?? null]);
  const [pathMatch] = options.sourcePath ? await sqlQuery<{ batchId: number; fileHash: string; batchNumber: string; versionNumber: number }>(`SELECT b.id AS "batchId",f.file_hash AS "fileHash",b.batch_number AS "batchNumber",f.version_number AS "versionNumber" FROM import_files f JOIN import_batches b ON b.id=f.batch_id WHERE lower(f.source_path)=lower($1) ORDER BY f.created_at DESC LIMIT 1`, [options.sourcePath]) : [];
  const [hashMatch] = await sqlQuery<{ batchId: number; batchNumber: string; versionNumber: number }>(`SELECT b.id AS "batchId",b.batch_number AS "batchNumber",f.version_number AS "versionNumber" FROM import_files f JOIN import_batches b ON b.id=f.batch_id WHERE f.file_hash=$1 ORDER BY f.created_at DESC LIMIT 1`, [fileHash]);
  const fingerprintStatus: FingerprintStatus = pathMatch?.fileHash === fileHash ? "UNCHANGED" : hashMatch ? "DUPLICATE" : pathMatch ? "UPDATED" : "NEW";
  const [version] = await sqlQuery<{ versionNumber: number }>(`SELECT COALESCE(max(version_number),0)::int AS "versionNumber" FROM import_files WHERE source_group_id=$1`, [sourceGroup.id]);
  const versionNumber = fingerprintStatus === "UNCHANGED" || fingerprintStatus === "DUPLICATE" ? Number(pathMatch?.versionNumber ?? hashMatch?.versionNumber ?? 1) : Number(version.versionNumber) + 1;
  const isCurrent = fingerprintStatus === "NEW" || fingerprintStatus === "UPDATED";
  const storageRoot = resolve(process.env.IMPORT_STORAGE_DIR ?? "./data/imports");
  const storageKey = `${batchNumber}/${filename}`;
  const batchStoragePath = resolve(storageRoot, batchNumber);
  const storagePath = resolve(batchStoragePath, filename);
  await mkdir(batchStoragePath, { recursive: true });
  await writeFile(storagePath, bytes, { flag: "wx" });
  if (embeddedImages.length) {
    const imageStoragePath = resolve(batchStoragePath, "images");
    await mkdir(imageStoragePath, { recursive: true });
    await Promise.all(embeddedImages.map((image) => writeFile(resolve(imageStoragePath, image.filename), image.bytes, { flag: "wx" })));
  }
  const sourceChannel = options.channel ?? "UPLOAD_UI";
  const workbookStructure = { filename, sheetCount: sheets.length, imageCount: embeddedImages.length, sheets: sheets.map((sheet) => ({ name: sheet.name, rows: sheet.rowCount, columns: sheet.columnCount, headerRow: sheet.headerRow, imageCount: sheet.imageCount ?? 0, classification: sheet.classification, recognizedFacts: analysis.facts.filter((fact) => fact.sheetIndex === sheet.index).map((fact) => fact.factType) })) };
  const statements: TransactionStatement[] = [
    { query: `INSERT INTO import_batches(batch_number,company_id,project_id,user_id,source_hash,source_channel,scope_type,context_confirmed,project_candidate,project_conflict,analysis_summary,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12) RETURNING id`, params: [batchNumber, companyId, projectId, user.id, fileHash, sourceChannel, scope, contextConfirmed, analysis.projectCandidate?.name ?? null, JSON.stringify(projectConflict), JSON.stringify(analysis), projectConflict ? "PROJECT_CONFLICT" : "UPLOADED"] },
    { query: `INSERT INTO import_files(batch_id,source_group_id,project_id,filename,source_path,extension,file_size,file_hash,modified_at,workbook_structure,fingerprint_status,managed_storage_key,version_number,is_current,channel,sheet_count) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13,$14,$15,$16) RETURNING id`, params: [{ fromResult: 0, key: "id" }, sourceGroup.id, projectId, filename, options.sourcePath ?? null, extname(filename).toLowerCase(), file.size, fileHash, options.modifiedAt ?? null, JSON.stringify(workbookStructure), fingerprintStatus, storageKey, versionNumber, isCurrent, sourceChannel, sheets.length] },
  ];
  for (const sheet of sheets) {
    const sheetFacts = analysis.facts.filter((fact) => fact.sheetIndex === sheet.index);
    const sheetConfidence = sheetFacts.length ? Math.round(sheetFacts.reduce((sum, fact) => sum + fact.confidence, 0) / sheetFacts.length) : sheet.classificationConfidence;
    statements.push({ query: `INSERT INTO import_sheets(batch_id,file_id,project_id,sheet_index,name,row_count,column_count,headers,preview_rows,raw_rows,classification,classification_confidence,classification_warnings,is_empty,structure,recognized_facts,analysis_confidence) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,$11,$12,$13::jsonb,$14,$15::jsonb,$16::jsonb,$17) RETURNING id`, params: [{ fromResult: 0, key: "id" }, { fromResult: 1, key: "id" }, projectId, sheet.index, sheet.name, sheet.rowCount, sheet.columnCount, JSON.stringify(sheet.headers), JSON.stringify(sheet.previewRows), JSON.stringify(sheet.rows), sheet.classification, sheet.classificationConfidence, JSON.stringify(sheet.classificationWarnings), sheet.isEmpty, JSON.stringify({ headerRow: sheet.headerRow, signature: sheet.signature, titleValues: sheet.titleValues ?? [], imageCount: sheet.imageCount ?? 0, images: sheet.images ?? [] }), JSON.stringify(sheetFacts), sheetConfidence] });
  }
  for (const fact of facts) {
    const factResultIndex = statements.length;
    statements.push({ query: `INSERT INTO import_business_facts(batch_id,project_id,company_id,fact_type,business_key,payload,confidence,confidence_level,status) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9) RETURNING id`, params: [{ fromResult: 0, key: "id" }, projectId, companyId, fact.factType, fact.businessKey, JSON.stringify(fact.payload), fact.confidence, fact.confidenceLevel, fact.status] });
    for (const evidence of fact.evidence) statements.push({ query: `INSERT INTO import_business_fact_evidence(fact_id,file_id,sheet_id,project_id,source_row,source_column,source_cell,evidence_role,raw_value) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, params: [{ fromResult: factResultIndex, key: "id" }, { fromResult: 1, key: "id" }, { fromResult: evidence.sheetIndex + 2, key: "id" }, projectId, evidence.sourceRow, evidence.sourceColumn, evidence.sourceCell, evidence.role, evidence.rawValue] });
  }
  let results: Record<string, unknown>[][];
  try { results = await runTransaction<Record<string, unknown>>(statements); }
  catch (error) { await rm(batchStoragePath, { recursive: true, force: true }).catch(() => undefined); throw error; }
  const batchId = Number(results[0][0].id);
  if (isCurrent) await sqlQuery(`UPDATE import_files SET is_current=(id=$1) WHERE source_group_id=$2`, [Number(results[1][0].id), sourceGroup.id]);
  const templates = await sqlQuery<{ id: number; name: string; businessType: string; signature: string; mappings: Record<string, string> }>(`SELECT id,name,business_type AS "businessType",sheet_signature AS signature,field_mappings AS mappings FROM import_mapping_templates WHERE company_id IS NULL OR company_id=$1`, [user.companyId]);
  const learnedAliases = await sqlQuery<{ businessType: string; sourceField: string; targetField: string }>(`SELECT business_type AS "businessType",source_field AS "sourceField",target_field AS "targetField" FROM field_aliases WHERE company_id IS NULL OR company_id=$1 ORDER BY created_at DESC`, [user.companyId]);
  return {
    batchId, batchNumber, filename, fileSize: file.size, sheetCount: sheets.length, sourceChannel,
    scope, projectId, companyId, contextConfirmed, projectConflict, analysis,
    fingerprintStatus, versionNumber, sourceGroupKey: groupKey, duplicateOf: (pathMatch ?? hashMatch)?.batchNumber ?? null, duplicateOfBatchId: (pathMatch ?? hashMatch)?.batchId ?? null,
    imageCount: embeddedImages.length,
    sheets: sheets.map((sheet, index) => ({ id: Number(results[index + 2][0].id), name: sheet.name, rowCount: sheet.rowCount, columnCount: sheet.columnCount, imageCount: sheet.imageCount ?? 0, headers: sheet.headers, previewRows: sheet.previewRows, classification: sheet.classification, classificationConfidence: sheet.classificationConfidence, classificationWarnings: sheet.classificationWarnings, recognizedFacts: analysis.facts.filter((fact) => fact.sheetIndex === sheet.index), learnedMappings: Object.fromEntries(migrationDefinitionsForAliases(learnedAliases, sheet.headers)), matchedTemplate: templates.find((template) => template.signature === sheet.signature) ?? null })),
  };
}

export async function bindMigrationContext(input: {
  batchId: number;
  scope: Exclude<ImportScope, "PENDING">;
  projectId?: number | null;
  projectName?: string;
  projectCode?: string;
  createProject?: boolean;
  companyId?: number | null;
  companyName?: string;
  createCompany?: boolean;
  overrideConflict?: boolean;
}, user: SessionUser) {
  const batch = await requireBatch(input.batchId, user); assertCan(user, "imports", "write");
  if (!["UPLOADED", "PROJECT_CONFLICT"].includes(String(batch.status))) throw new Error("数据归属只能在暂存预检前修改");
  let project: Awaited<ReturnType<typeof resolveProjectForImport>> | null = null;
  let company: Awaited<ReturnType<typeof resolveCompanyForImport>> | null = null;
  if (input.scope === "PROJECT") project = await resolveProjectForImport(input, user);
  if (input.scope === "COMPANY") company = await resolveCompanyForImport(input, user);
  const projectId = project?.id ?? null;
  const companyId = project?.companyId ?? company?.id ?? (input.scope === "MASTER" ? user.companyId : null);
  const analysis = jsonValue<IntelligentWorkbookAnalysis | null>(batch.analysis_summary, null);
  const viableProjectCandidate = analysis?.projectCandidate && extractProjectCandidate(analysis.projectCandidate.name) ? analysis.projectCandidate : null;
  const conflict = project ? detectProjectConflict(project.name, viableProjectCandidate) : null;
  const contextConfirmed = !conflict || Boolean(input.overrideConflict);
  const nextStatus = conflict && !input.overrideConflict ? "PROJECT_CONFLICT" : "UPLOADED";
  const conflictJson = conflict && !input.overrideConflict ? JSON.stringify(conflict) : null;
  await runTransaction([
    { query: `UPDATE import_batches SET scope_type=$1,company_id=$2,project_id=$3,context_confirmed=$4,project_conflict=$5::jsonb,status=$6,updated_at=now() WHERE id=$7`, params: [input.scope, companyId, projectId, contextConfirmed, conflictJson, nextStatus, input.batchId] },
    { query: `UPDATE import_files SET project_id=$1 WHERE batch_id=$2`, params: [projectId, input.batchId] },
    { query: `UPDATE import_sheets SET project_id=$1 WHERE batch_id=$2`, params: [projectId, input.batchId] },
    { query: `UPDATE import_staging_rows SET project_id=$1 WHERE batch_id=$2`, params: [projectId, input.batchId] },
    { query: `UPDATE import_business_facts SET project_id=$1,company_id=$2,status=CASE WHEN $3::boolean THEN CASE WHEN confidence_level='HIGH' THEN 'AUTO_ACCEPTED' ELSE 'REQUIRES_CONFIRMATION' END ELSE 'CONFLICT' END WHERE batch_id=$4`, params: [projectId, companyId, contextConfirmed, input.batchId] },
    { query: `UPDATE import_business_fact_evidence SET project_id=$1 WHERE fact_id IN (SELECT id FROM import_business_facts WHERE batch_id=$2)`, params: [projectId, input.batchId] },
    { query: `UPDATE import_data_lineage SET project_id=$1 WHERE batch_id=$2`, params: [projectId, input.batchId] },
    { query: `INSERT INTO audit_logs(company_id,project_id,user_id,object_type,object_id,action,after,ip) VALUES($1,$2,$3,'import_batch',$4,'BIND_IMPORT_CONTEXT',$5::jsonb,'127.0.0.1')`, params: [companyId, projectId, user.id, input.batchId, JSON.stringify({ scope: input.scope, projectId, companyId, overrideConflict: Boolean(input.overrideConflict) })] },
  ]);
  return { scope: input.scope, contextConfirmed, project, company, conflict: conflict && !input.overrideConflict ? conflict : null, analysis };
}

export async function reviewBusinessFact(batchId: number, factId: number, decision: "ACCEPT" | "IGNORE", user: SessionUser) {
  const batch = await requireBatch(batchId, user); assertCan(user, "imports", "write");
  if (!Boolean(batch.context_confirmed)) throw new Error("请先确认数据归属并处理项目冲突");
  const status = decision === "ACCEPT" ? "USER_ACCEPTED" : "IGNORED";
  const [fact] = await sqlQuery<{ id: number }>(`UPDATE import_business_facts SET status=$1 WHERE id=$2 AND batch_id=$3 AND status IN ('REQUIRES_CONFIRMATION','AUTO_ACCEPTED') RETURNING id`, [status, factId, batchId]);
  if (!fact) throw new Error("识别项不存在或当前状态不可修改");
  return { ok: true, factId, status };
}

function migrationDefinitionsForAliases(aliases: { businessType: string; sourceField: string; targetField: string }[], headers: string[]) {
  return [...new Set(aliases.map((alias) => alias.businessType))].map((businessType) => [businessType, Object.fromEntries(headers.flatMap((header) => {
    const match = aliases.find((alias) => alias.businessType === businessType && alias.sourceField === normalizeHeader(header));
    return match ? [[header, match.targetField]] : [];
  }))] as const);
}

async function existingDuplicates(resource: ResourceKey) {
  const rule = duplicateRules[resource]; const output = new Map<string, number>(); if (!rule) return output;
  const scopeColumn = rule.companyScoped ? "company_id" : rule.scopeColumn ?? "NULL";
  const rows = await sqlQuery<{ id: number; value: string; scopeId: number | null }>(`SELECT id,${rule.column}::text AS value,${scopeColumn} AS "scopeId" FROM ${rule.table}`);
  rows.forEach((row) => output.set(`${scopeColumn === "NULL" ? "global" : Number(row.scopeId)}:${normalizeHeader(row.value)}`, Number(row.id)));
  return output;
}

async function saveMappingTemplate(user: SessionUser, name: string, businessType: ResourceKey, headers: string[], mappings: Record<string, string>) {
  const signature = sheetSignature(headers);
  const [existing] = await sqlQuery<{ id: number }>(`SELECT id FROM import_mapping_templates WHERE business_type=$1 AND sheet_signature=$2 AND (company_id=$3 OR company_id IS NULL) ORDER BY company_id NULLS LAST LIMIT 1`, [businessType, signature, user.companyId]);
  let templateId: number;
  if (existing) {
    await sqlQuery(`UPDATE import_mapping_templates SET name=$1,source_fields=$2::jsonb,field_mappings=$3::jsonb,updated_at=now(),updated_by=$4 WHERE id=$5`, [name, JSON.stringify(headers), JSON.stringify(mappings), user.id, existing.id]);
    templateId = Number(existing.id);
  } else {
    const [created] = await sqlQuery<{ id: number }>(`INSERT INTO import_mapping_templates(company_id,name,business_type,sheet_signature,source_fields,field_mappings,created_by) VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7) RETURNING id`, [user.companyId, name, businessType, signature, JSON.stringify(headers), JSON.stringify(mappings), user.id]);
    templateId = Number(created.id);
  }
  for (const [sourceField, targetField] of Object.entries(mappings).filter(([, target]) => target)) {
    await sqlQuery(`INSERT INTO field_aliases(company_id,business_type,source_field,target_field,source,created_by) SELECT $1,$2,$3,$4,'MAPPING_TEMPLATE',$5 WHERE NOT EXISTS (SELECT 1 FROM field_aliases WHERE company_id IS NOT DISTINCT FROM $1 AND business_type=$2 AND source_field=$3 AND target_field=$4)`, [user.companyId, businessType, normalizeHeader(sourceField), targetField, user.id]);
  }
  return templateId;
}

export async function stageMigrationBatch(input: { batchId: number; sheetId: number; businessType: ResourceKey; mappings: Record<string, string>; saveTemplateName?: string; autoAllSheets?: boolean }, user: SessionUser) {
  const batch = await requireBatch(input.batchId, user); assertCan(user, "imports", "write");
  const autoAllSheets = Boolean(input.autoAllSheets);
  const businessType: ResourceKey = autoAllSheets ? "skus" : input.businessType;
  if (user.role !== "owner") assertCan(user, businessType, "write");
  if (["COMPLETED", "ROLLED_BACK"].includes(String(batch.status))) throw new Error("已完成或已撤销的批次不能重新暂存");
  if (String(batch.status) === "PROJECT_CONFLICT" || (String(batch.scope_type) === "PROJECT" && !Boolean(batch.context_confirmed))) throw new Error("PROJECT_CONFLICT：请先确认目标项目");
  const definition = migrationDefinition(businessType); if (!definition) throw new Error("不支持的业务类型");
  const projectScopedTypes = new Set<ResourceKey>(["contracts", "receivables", "receipts", "skus", "quotes", "purchase-requests", "payables", "payments", "invoices"]);
  const batchProjectId = batch.project_id === null ? null : Number(batch.project_id);
  const batchCompanyId = batch.company_id === null ? null : Number(batch.company_id);
  const contextBound = Boolean(batch.context_confirmed);
  if (projectScopedTypes.has(businessType) && (!batchProjectId || String(batch.scope_type) !== "PROJECT")) throw new Error("PROJECT_CONTEXT_REQUIRED");
  type StageSheet = { id: number; name: string; sheetIndex: number; classification: string; headers: string[]; rawRows: Record<string, unknown>[] };
  const sourceSheets = autoAllSheets
    ? await sqlQuery<StageSheet>(`SELECT id,name,sheet_index AS "sheetIndex",classification,headers,raw_rows AS "rawRows" FROM import_sheets WHERE batch_id=$1 AND classification IN ('SKU_DETAIL','SUPPLIER_QUOTE','PURCHASE_ORDER') AND NOT is_empty ORDER BY sheet_index`, [input.batchId])
    : await sqlQuery<StageSheet>(`SELECT id,name,sheet_index AS "sheetIndex",classification,headers,raw_rows AS "rawRows" FROM import_sheets WHERE id=$1 AND batch_id=$2`, [input.sheetId, input.batchId]);
  if (!sourceSheets.length) throw new Error(autoAllSheets ? "没有识别到可自动导入的产品明细 Sheet" : "Sheet 不存在");
  const generatedSkuFields = new Set(["projectId", "code", "room", "category", "name", "unit", "imageUrl"]);
  if (!autoAllSheets) {
    const mappedTargets = new Set(Object.values(input.mappings).filter(Boolean));
    const missing = definition.fields.filter((field) => field.required && !mappedTargets.has(field.key) && !(field.key === "projectId" && contextBound && batchProjectId) && !(field.key === "companyId" && contextBound && batchCompanyId) && !(businessType === "skus" && generatedSkuFields.has(field.key)));
    if (missing.length) throw new Error(`缺少必填字段映射：${missing.map((field) => field.displayLabel).join("、")}`);
  }
  const catalog = await loadCatalog(user); const duplicates = await existingDuplicates(businessType); const seen = new Set<string>();
  const rawValue = (raw: Record<string, unknown>, patterns: RegExp[]) => Object.entries(raw).find(([key, value]) => key !== "__sourceRow" && patterns.some((pattern) => pattern.test(normalizeHeader(key))) && String(value ?? "").trim())?.[1];
  const staged = sourceSheets.flatMap((sheet) => {
    const headers = jsonValue(sheet.headers, [] as string[]);
    const mappings = autoAllSheets ? suggestFieldMappings("skus", headers) : input.mappings;
    const rawRows = jsonValue(sheet.rawRows, [] as Record<string, unknown>[]);
    return rawRows.flatMap((raw, index) => {
    const normalized = applyFieldMapping(businessType, raw, mappings); const issues: MigrationIssue[] = []; const resolutions: Resolution[] = [];
    if (businessType === "skus") {
      const sourceRow = Number(raw.__sourceRow ?? index + 2);
      const specification = String(rawValue(raw, [/规格/u, /型号/u, /尺寸/u]) ?? "").trim();
      const material = String(rawValue(raw, [/材质/u]) ?? "").trim();
      normalized.projectId = batchProjectId;
      normalized.code = String(normalized.code ?? "").trim() || `${String(batch.batch_number).replace("IMP-", "SKU-")}-S${sheet.sheetIndex + 1}-R${sourceRow}`;
      normalized.room = String(normalized.room ?? "").trim() || String(rawValue(raw, [/空间/u, /区域/u, /位置/u, /摆放/u]) ?? sheet.name).trim();
      normalized.category = String(normalized.category ?? "").trim() || sheet.name.trim();
      normalized.name = String(normalized.name ?? "").trim() || String(rawValue(raw, [/产品名称/u, /品名/u, /^型号$/u, /^名称$/u]) ?? "").trim() || [sheet.name.trim(), specification, material].filter(Boolean).join(" · ").slice(0, 120);
      normalized.quantity = parseQuantity(normalized.quantity ?? rawValue(raw, [/数量/u]));
      normalized.unit = String(normalized.unit ?? "").trim() || String(rawValue(raw, [/单位/u]) ?? "件").trim();
      normalized.budgetUnitYuan = parseAmount(normalized.budgetUnitYuan ?? rawValue(raw, [/单价/u, /^价格$/u, /预算价/u]));
      normalized.imageUrl = String(normalized.imageUrl ?? raw.__imageUrl ?? "").trim();
      if (autoAllSheets && (!(Number(normalized.quantity) > 0) || !(Number(normalized.budgetUnitYuan) > 0) || (!String(normalized.name).trim() && !String(normalized.imageUrl).trim()))) return [];
    }
    let companyId = contextBound ? batchCompanyId ?? user.companyId : user.companyId;
    for (const field of definition.fields.filter((item) => item.reference === "company")) {
      if (contextBound && batchCompanyId) { normalized[field.key] = batchCompanyId; companyId = batchCompanyId; continue; }
      const value = String(normalized[field.key] ?? ""); const resolution = { ...resolveReference("company", value, catalog.company, null), fieldKey: field.key }; resolutions.push(resolution);
      if (resolution.resolvedEntityId) { normalized[field.key] = resolution.resolvedEntityId; companyId = resolution.resolvedEntityId; }
    }
    for (const field of definition.fields.filter((item) => item.reference && item.reference !== "company")) {
      if (field.reference === "project" && batchProjectId) {
        const inputProject = String(normalized[field.key] ?? "").trim();
        if (inputProject) {
          const detected = resolveReference("project", inputProject, catalog.project, companyId);
          if (detected.resolvedEntityId && detected.resolvedEntityId !== batchProjectId) issues.push({ field: field.displayLabel, severity: "ERROR", code: "PROJECT_CONFLICT", message: "行内项目与当前导入项目不一致" });
        }
        normalized[field.key] = batchProjectId;
        continue;
      }
      const value = String(normalized[field.key] ?? ""); if (!value && !field.required) continue;
      const resolution = { ...resolveReference(field.reference!, value, catalog[field.reference!], companyId), fieldKey: field.key }; resolutions.push(resolution);
      if (resolution.resolvedEntityId) { normalized[field.key] = resolution.resolvedEntityId; companyId ??= resolution.candidates[0]?.companyId ?? null; }
    }
    for (const resolution of resolutions.filter((item) => item.status !== "EXACT_MATCH")) {
      const severity = resolution.status === "POSSIBLE_MATCH" ? "WARNING" : "ERROR";
      const messages: Record<ResolutionStatus, string> = { EXACT_MATCH: "精确匹配", POSSIBLE_MATCH: "存在一个可能匹配项，请人工确认", NOT_FOUND: "未找到关联对象", MULTIPLE_MATCHES: "存在多个匹配项，请人工选择" };
      issues.push({ field: definition.fields.find((field) => field.key === resolution.fieldKey)?.displayLabel ?? resolution.fieldKey, severity, code: resolution.status, message: messages[resolution.status] });
    }
    issues.push(...validateMigrationRow(businessType, normalized));
    for (const key of Object.keys(normalized).filter((key) => key.endsWith("Yuan") && key !== "balanceYuan")) if (!(Number(normalized[key]) > 0)) issues.push({ field: definition.fields.find((field) => field.key === key)?.displayLabel ?? key, severity: "ERROR", code: "FINANCIAL_AMOUNT", message: "业务金额必须大于 0" });
    if (!scopeAllowed(user, companyId)) issues.push({ field: "公司范围", severity: "ERROR", code: "SCOPE", message: "不能迁移其他公司数据" });
    const rule = duplicateRules[businessType]; let duplicateStatus = "NEW"; let duplicateTargetId: number | null = null; let action = "CREATE";
    if (rule) {
      const value = String(normalized[rule.field] ?? ""); const scopeId = rule.companyScoped ? companyId : rule.scopeField ? normalized[rule.scopeField] : "global"; const key = `${scopeId}:${normalizeHeader(value)}`;
      if (seen.has(key)) { duplicateStatus = "POSSIBLE_DUPLICATE"; action = "SKIP"; issues.push({ field: rule.field, severity: "ERROR", code: "FILE_DUPLICATE", message: "文件内存在重复唯一值" }); }
      else seen.add(key);
      if (duplicates.has(key)) { duplicateStatus = "EXISTING"; duplicateTargetId = duplicates.get(key)!; action = rule.financial ? "SKIP" : "MATCH"; issues.push({ field: rule.field, severity: "WARNING", code: "EXISTING", message: rule.financial ? "财务事实已存在，默认跳过且禁止覆盖" : "基础资料已存在，默认匹配现有记录" }); }
    }
    const status = issues.some((issue) => issue.severity === "ERROR") ? "ERROR" : issues.length ? "WARNING" : "READY";
    return [{ sheetId: Number(sheet.id), sourceRow: Number(raw.__sourceRow ?? index + 2), raw, normalized, issues, resolutions, status, duplicateStatus, duplicateTargetId, action }];
  });
  });
  if (autoAllSheets && !staged.length) throw new Error("识别到了产品 Sheet，但没有找到同时包含数量和单价的有效产品行");
  const eligible = staged.map((row, index) => ({ row, index })).filter(({ row }) => row.action === "CREATE" && !row.issues.some((issue) => issue.severity === "ERROR"));
  if (eligible.length) {
    const businessPreflight = await preflightImport(businessType, eligible.map(({ row }) => row.normalized), user, { ownerMigration: true });
    for (const error of businessPreflight.errors) {
      const target = eligible[Math.max(0, error.row - 2)]?.row; if (!target) continue;
      if (!target.issues.some((issue) => issue.message === error.message && issue.field === error.field)) target.issues.push({ field: error.field, severity: "ERROR", code: "BUSINESS_RULE", message: error.message });
      target.status = "ERROR";
    }
  }
  await runTransaction([{ query: `DELETE FROM import_reference_resolutions WHERE batch_id=$1`, params: [input.batchId] }, { query: `DELETE FROM import_staging_rows WHERE batch_id=$1`, params: [input.batchId] }]);
  for (let offset = 0; offset < staged.length; offset += 250) {
    const statements: TransactionStatement[] = [];
    for (const row of staged.slice(offset, offset + 250)) {
      const resultIndex = statements.length;
      statements.push({ query: `INSERT INTO import_staging_rows(batch_id,sheet_id,project_id,business_type,source_row,raw_data,normalized_data,issues,duplicate_status,duplicate_target_id,action,status) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9,$10,$11,$12) RETURNING id`, params: [input.batchId, row.sheetId, batchProjectId, businessType, row.sourceRow, JSON.stringify(row.raw), JSON.stringify(row.normalized), JSON.stringify(row.issues), row.duplicateStatus, row.duplicateTargetId, row.action, row.status] });
      for (const resolution of row.resolutions) statements.push({ query: `INSERT INTO import_reference_resolutions(batch_id,staging_row_id,field_key,entity_type,input_value,status,resolved_entity_id,candidates) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`, params: [input.batchId, { fromResult: resultIndex, key: "id" }, resolution.fieldKey, resolution.entityType, resolution.inputValue, resolution.status, resolution.resolvedEntityId, JSON.stringify(resolution.candidates.slice(0, 8))] });
    }
    await runTransaction(statements);
  }
  const counts = { ready: staged.filter((row) => row.status === "READY").length, warning: staged.filter((row) => row.status === "WARNING").length, error: staged.filter((row) => row.status === "ERROR").length };
  const firstHeaders = jsonValue(sourceSheets[0].headers, [] as string[]);
  const mappingTemplateId = !autoAllSheets && input.saveTemplateName?.trim() ? await saveMappingTemplate(user, input.saveTemplateName.trim(), businessType, firstHeaders, input.mappings) : null;
  const selectedSheetIds = sourceSheets.map((sheet) => Number(sheet.id));
  await runTransaction([
    { query: `UPDATE import_sheets SET selected=(id = ANY($1::int[])) WHERE batch_id=$2`, params: [selectedSheetIds, input.batchId] },
    ...(autoAllSheets ? [{ query: `UPDATE import_business_facts SET status=CASE WHEN fact_type='SKU' THEN 'AUTO_ACCEPTED' WHEN status='REQUIRES_CONFIRMATION' THEN 'IGNORED' ELSE status END WHERE batch_id=$1`, params: [input.batchId] }] : []),
    { query: `UPDATE import_batches SET business_type=$1,mapping_template_id=$2,total_rows=$3,ready_rows=$4,warning_rows=$5,error_rows=$6,status='VALIDATED',error_message=NULL,updated_at=now() WHERE id=$7`, params: [businessType, mappingTemplateId, staged.length, counts.ready, counts.warning, counts.error, input.batchId] },
  ]);
  return { ...counts, total: staged.length, sheetCount: sourceSheets.length, imageRows: staged.filter((row) => String(row.normalized.imageUrl ?? "")).length, automatic: autoAllSheets };
}

export async function getMigrationOverview(user: SessionUser) {
  assertCan(user, "imports");
  const scope = user.role === "owner" ? { sql: "TRUE", params: [] as unknown[] } : { sql: `(b.company_id=$1 OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id=b.project_id AND pm.user_id=$2))`, params: [user.companyId, user.id] as unknown[] };
  const batches = await sqlQuery<Record<string, unknown>>(`SELECT b.id,b.batch_number AS "batchNumber",b.business_type AS "businessType",b.scope_type AS "scopeType",b.project_id AS "projectId",p.name AS "projectName",b.project_candidate AS "projectCandidate",b.context_confirmed AS "contextConfirmed",b.project_conflict AS "projectConflict",b.analysis_summary AS analysis,b.source_hash AS "sourceHash",b.source_channel AS "sourceChannel",b.status,b.total_rows AS "totalRows",b.ready_rows AS "readyRows",b.warning_rows AS "warningRows",b.error_rows AS "errorRows",b.success_rows AS "successRows",b.skipped_rows AS "skippedRows",b.created_at AS "createdAt",f.filename,(SELECT string_agg(s.name,' / ' ORDER BY s.sheet_index) FROM import_sheets s WHERE s.batch_id=b.id AND s.selected) AS "sheetName",m.name AS "mappingName",u.name AS "userName" FROM import_batches b LEFT JOIN projects p ON p.id=b.project_id LEFT JOIN import_files f ON f.batch_id=b.id LEFT JOIN import_mapping_templates m ON m.id=b.mapping_template_id JOIN users u ON u.id=b.user_id WHERE ${scope.sql} ORDER BY b.created_at DESC LIMIT 30`, scope.params);
  const [summary] = await sqlQuery<Record<string, unknown>>(`SELECT (SELECT count(*)::int FROM projects) AS projects,(SELECT count(*)::int FROM suppliers) AS suppliers,(SELECT count(*)::int FROM skus) AS skus,(SELECT count(*)::int FROM purchase_orders) AS purchases,(SELECT count(*)::int FROM payments WHERE NOT is_void) AS payments`);
  return { batches, summary, ...(await getImportContextOptions(user)) };
}

export async function getMigrationBatch(batchId: number, user: SessionUser, page = 1) {
  const batch = await requireBatch(batchId, user); const pageSize = 50; const offset = Math.max(0, page - 1) * pageSize;
  const [file] = await sqlQuery<Record<string, unknown>>(`SELECT project_id AS "projectId",filename,source_path AS "sourcePath",extension,file_size AS "fileSize",sheet_count AS "sheetCount",fingerprint_status AS "fingerprintStatus",version_number AS "versionNumber",channel,managed_storage_key AS "managedStorageKey" FROM import_files WHERE batch_id=$1`, [batchId]);
  const sheets = await sqlQuery<Record<string, unknown>>(`SELECT id,project_id AS "projectId",name,row_count AS "rowCount",column_count AS "columnCount",COALESCE((structure->>'imageCount')::int,0) AS "imageCount",headers,preview_rows AS "previewRows",classification,classification_confidence AS "classificationConfidence",classification_warnings AS "classificationWarnings",recognized_facts AS "recognizedFacts",analysis_confidence AS "analysisConfidence",is_empty AS "isEmpty",selected FROM import_sheets WHERE batch_id=$1 ORDER BY sheet_index`, [batchId]);
  const rows = await sqlQuery<Record<string, unknown>>(`SELECT r.id,r.project_id AS "projectId",r.business_type AS "businessType",r.source_row AS "sourceRow",s.name AS "sheetName",r.normalized_data AS "normalizedData",r.issues,r.duplicate_status AS "duplicateStatus",r.duplicate_target_id AS "duplicateTargetId",r.action,r.status,r.target_table AS "targetTable",r.target_id AS "targetId" FROM import_staging_rows r JOIN import_sheets s ON s.id=r.sheet_id WHERE r.batch_id=$1 ORDER BY s.sheet_index,r.source_row LIMIT $2 OFFSET $3`, [batchId, pageSize, offset]);
  const resolutions = await sqlQuery<Record<string, unknown>>(`SELECT x.id,x.staging_row_id AS "stagingRowId",x.field_key AS "fieldKey",x.entity_type AS "entityType",x.input_value AS "inputValue",x.status,x.resolved_entity_id AS "resolvedEntityId",x.candidates FROM import_reference_resolutions x WHERE x.staging_row_id IN (SELECT r.id FROM import_staging_rows r JOIN import_sheets s ON s.id=r.sheet_id WHERE r.batch_id=$1 ORDER BY s.sheet_index,r.source_row LIMIT $2 OFFSET $3) AND x.status<>'EXACT_MATCH' ORDER BY x.staging_row_id,x.id`, [batchId, pageSize, offset]);
  const [blocking] = await sqlQuery<{ unresolved: number }>(`SELECT count(*)::int AS unresolved FROM import_reference_resolutions x JOIN import_staging_rows r ON r.id=x.staging_row_id WHERE x.batch_id=$1 AND x.status<>'EXACT_MATCH' AND r.action<>'SKIP'`, [batchId]);
  const facts = await sqlQuery<Record<string, unknown>>(`SELECT id,project_id AS "projectId",fact_type AS "factType",business_key AS "businessKey",payload,confidence,confidence_level AS "confidenceLevel",status FROM import_business_facts WHERE batch_id=$1 AND fact_type<>'COST_ITEM' ORDER BY confidence DESC,id`, [batchId]);
  return { batch, file, sheets, rows, resolutions, facts, unresolvedReferences: Number(blocking.unresolved), page, pageSize };
}

export async function getImportMedia(batchNumber: string, filename: string, user: SessionUser) {
  if (!/^IMP-\d{8}-\d{4}$/u.test(batchNumber) || basename(filename) !== filename || !/^s\d+-r\d+-c\d+-\d+\.[a-z0-9]+$/iu.test(filename)) throw new Error("图片地址无效");
  const [batch] = await sqlQuery<{ id: number }>(`SELECT id FROM import_batches WHERE batch_number=$1`, [batchNumber]);
  if (!batch) throw new Error("导入图片不存在");
  await requireBatch(Number(batch.id), user);
  const [metadata] = await sqlQuery<{ mimeType: string }>(`SELECT image->>'mimeType' AS "mimeType" FROM import_sheets s CROSS JOIN LATERAL jsonb_array_elements(COALESCE(s.structure->'images','[]'::jsonb)) image WHERE s.batch_id=$1 AND image->>'filename'=$2 LIMIT 1`, [batch.id, filename]);
  if (!metadata) throw new Error("导入图片不存在");
  const imageRoot = resolve(process.env.IMPORT_STORAGE_DIR ?? "./data/imports", batchNumber, "images");
  const imagePath = resolve(imageRoot, filename);
  if (!imagePath.startsWith(`${imageRoot}${sep}`)) throw new Error("图片地址无效");
  return { buffer: await readFile(imagePath), mimeType: metadata.mimeType };
}

export async function exportMigrationErrors(batchId: number, user: SessionUser) {
  const batch = await requireBatch(batchId, user); assertCan(user, "imports");
  const rows = await sqlQuery<{ sourceRow: number; normalizedData: Record<string, unknown>; issues: MigrationIssue[] }>(`SELECT source_row AS "sourceRow",normalized_data AS "normalizedData",issues FROM import_staging_rows WHERE batch_id=$1 AND status='ERROR' ORDER BY source_row`, [batchId]);
  if (!rows.length) throw new Error("当前批次没有错误行");
  const output = rows.map((row) => ({ 原始行号: Number(row.sourceRow), 问题: jsonValue(row.issues, [] as MigrationIssue[]).map((issue) => `${issue.field}：${issue.message}`).join("；"), ...jsonValue(row.normalizedData, {} as Record<string, unknown>) }));
  const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(output), "错误行");
  return { filename: `${String(batch.batch_number)}-错误行.xlsx`, buffer: XLSX.write(book, { type: "buffer", bookType: "xlsx" }) as Buffer };
}

export async function updateStagingRow(batchId: number, rowId: number, input: { action?: string; confirmedReferenceId?: number; fieldKey?: string; updates?: Record<string, unknown> }, user: SessionUser) {
  const batch = await requireBatch(batchId, user); assertCan(user, "imports", "write");
  if (String(batch.status) !== "VALIDATED") throw new Error("当前批次不能修改暂存数据");
  if (input.action) {
    if (!["CREATE", "MATCH", "SKIP"].includes(input.action)) throw new Error("无效的重复数据处理方式");
    if (input.action === "CREATE") {
      const [row] = await sqlQuery<{ issues: MigrationIssue[] }>(`SELECT issues FROM import_staging_rows WHERE id=$1 AND batch_id=$2`, [rowId, batchId]);
      if (jsonValue(row?.issues, [] as MigrationIssue[]).some((issue) => issue.code === "EXISTING") && duplicateRules[String(batch.business_type) as ResourceKey]?.financial) throw new Error("财务事实不得作为新记录重复导入");
    }
    const nextStatus = input.action === "SKIP" ? "SKIPPED" : null;
    if (nextStatus) await sqlQuery(`UPDATE import_staging_rows SET action=$1,status=$2,updated_at=now() WHERE id=$3 AND batch_id=$4`, [input.action, nextStatus, rowId, batchId]);
    else await sqlQuery(`UPDATE import_staging_rows SET action=$1,status=CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(issues) i WHERE i->>'severity'='ERROR') THEN 'ERROR' WHEN jsonb_array_length(issues)>0 THEN 'WARNING' ELSE 'READY' END,updated_at=now() WHERE id=$2 AND batch_id=$3`, [input.action, rowId, batchId]);
  }
  if (input.confirmedReferenceId && input.fieldKey) {
    const [row] = await sqlQuery<{ normalizedData: Record<string, unknown>; issues: MigrationIssue[] }>(`SELECT normalized_data AS "normalizedData",issues FROM import_staging_rows WHERE id=$1 AND batch_id=$2`, [rowId, batchId]); if (!row) throw new Error("暂存行不存在");
    const [reference] = await sqlQuery<{ entityType: ReferenceEntity; inputValue: string }>(`SELECT entity_type AS "entityType",input_value AS "inputValue" FROM import_reference_resolutions WHERE staging_row_id=$1 AND field_key=$2`, [rowId, input.fieldKey]);
    const normalized = jsonValue(row.normalizedData, {} as Record<string, unknown>); normalized[input.fieldKey] = input.confirmedReferenceId;
    const fieldLabel = migrationDefinition(String(batch.business_type))?.fields.find((field) => field.key === input.fieldKey)?.displayLabel;
    const issues = jsonValue(row.issues, [] as MigrationIssue[]).filter((issue) => !(issue.field === fieldLabel && ["POSSIBLE_MATCH", "MULTIPLE_MATCHES", "NOT_FOUND"].includes(issue.code)));
    const status = issues.some((issue) => issue.severity === "ERROR") ? "ERROR" : issues.length ? "WARNING" : "READY";
    const statements: TransactionStatement[] = [{ query: `UPDATE import_staging_rows SET normalized_data=$1::jsonb,issues=$2::jsonb,status=$3,updated_at=now() WHERE id=$4`, params: [JSON.stringify(normalized), JSON.stringify(issues), status, rowId] }, { query: `UPDATE import_reference_resolutions SET status='EXACT_MATCH',resolved_entity_id=$1,confirmed_by=$2,confirmed_at=now() WHERE staging_row_id=$3 AND field_key=$4`, params: [input.confirmedReferenceId, user.id, rowId, input.fieldKey] }];
    if (reference) {
      const catalog = await loadCatalog(user); const candidate = catalog[reference.entityType].find((item) => item.id === input.confirmedReferenceId);
      if (candidate?.companyId) statements.push({ query: `INSERT INTO entity_aliases(company_id,entity_type,entity_id,alias,source,created_by) VALUES($1,$2,$3,$4,'IMPORT_CONFIRMATION',$5) ON CONFLICT DO NOTHING`, params: [candidate.companyId, reference.entityType, input.confirmedReferenceId, reference.inputValue, user.id] });
    }
    await runTransaction(statements);
  }
  if (input.updates && typeof input.updates === "object") {
    const [row] = await sqlQuery<{ normalizedData: Record<string, unknown>; issues: MigrationIssue[] }>(`SELECT normalized_data AS "normalizedData",issues FROM import_staging_rows WHERE id=$1 AND batch_id=$2`, [rowId, batchId]); if (!row) throw new Error("暂存行不存在");
    const normalized: Record<string, unknown> = { ...jsonValue(row.normalizedData, {} as Record<string, unknown>), ...input.updates }; const preservedCodes = new Set(["POSSIBLE_MATCH", "MULTIPLE_MATCHES", "NOT_FOUND", "EXISTING", "FILE_DUPLICATE", "SCOPE"]);
    const issues = [...jsonValue(row.issues, [] as MigrationIssue[]).filter((issue) => preservedCodes.has(issue.code)), ...validateMigrationRow(String(batch.business_type), normalized)];
    for (const key of Object.keys(normalized).filter((key) => key.endsWith("Yuan") && key !== "balanceYuan")) if (!(Number(normalized[key]) > 0)) issues.push({ field: key, severity: "ERROR", code: "FINANCIAL_AMOUNT", message: "业务金额必须大于 0" });
    const status = issues.some((issue) => issue.severity === "ERROR") ? "ERROR" : issues.length ? "WARNING" : "READY";
    await sqlQuery(`UPDATE import_staging_rows SET normalized_data=$1::jsonb,issues=$2::jsonb,status=$3,updated_at=now() WHERE id=$4`, [JSON.stringify(normalized), JSON.stringify(issues), status, rowId]);
  }
  await sqlQuery(`UPDATE import_batches b SET ready_rows=x.ready,warning_rows=x.warning,error_rows=x.error,updated_at=now() FROM (SELECT count(*) FILTER (WHERE status='READY')::int AS ready,count(*) FILTER (WHERE status='WARNING')::int AS warning,count(*) FILTER (WHERE status='ERROR')::int AS error FROM import_staging_rows WHERE batch_id=$1) x WHERE b.id=$1`, [batchId]);
}

export async function assignMigrationProjectCompany(batchId: number, companyId: number, user: SessionUser) {
  const batch = await requireBatch(batchId, user); assertCan(user, "imports", "write");
  if (String(batch.scope_type) !== "PROJECT" || !batch.project_id) throw new Error("当前批次未绑定项目");
  if (!["VALIDATED", "READY_TO_IMPORT"].includes(String(batch.status))) throw new Error("只能在预检完成后补充项目公司");
  if (!Number.isInteger(companyId) || companyId <= 0) throw new Error("请选择有效的所属公司");
  if (user.role !== "owner" && companyId !== user.companyId) throw new Error("FORBIDDEN");
  const [company] = await sqlQuery<{ id: number; name: string }>(`SELECT id,name FROM companies WHERE id=$1 AND status='active'`, [companyId]);
  if (!company) throw new Error("公司不存在或不可用");
  const [project] = await sqlQuery<{ id: number; companyId: number | null }>(`SELECT id,company_id AS "companyId" FROM projects WHERE id=$1`, [batch.project_id]);
  if (!project) throw new Error("目标项目不存在");
  if (project.companyId !== null && Number(project.companyId) !== companyId) throw new Error("项目已归属其他公司，不能通过导入批次改绑");
  await runTransaction([
    { query: `UPDATE projects SET company_id=$1,updated_at=now(),updated_by=$2 WHERE id=$3 AND company_id IS NULL`, params: [companyId, user.id, project.id] },
    { query: `UPDATE import_batches SET company_id=$1,updated_at=now() WHERE id=$2`, params: [companyId, batchId] },
    { query: `UPDATE import_business_facts SET company_id=$1 WHERE batch_id=$2`, params: [companyId, batchId] },
    { query: `INSERT INTO audit_logs(company_id,project_id,user_id,object_type,object_id,action,after,ip) VALUES($1,$2,$3,'import_batch',$4,'ASSIGN_PROJECT_COMPANY',jsonb_build_object('company_id',$1::int,'company_name',$5::text),'127.0.0.1')`, params: [companyId, project.id, user.id, batchId, company.name] },
  ]);
  return { ok: true, company: { id: Number(company.id), name: company.name } };
}

export async function confirmMigrationBatch(batchId: number, user: SessionUser, confirmation?: string) {
  const batch = await requireBatch(batchId, user); assertCan(user, "imports", "write");
  if (isRealDataMode() && confirmation !== "确认导入真实数据") throw new Error("请输入“确认导入真实数据”后再继续");
  if (String(batch.status) !== "VALIDATED") throw new Error("当前批次不处于人工确认阶段");
  if (String(batch.scope_type) === "PROJECT" && (!batch.project_id || !Boolean(batch.context_confirmed))) throw new Error("PROJECT_CONTEXT_REQUIRED");
  const [blocking] = await sqlQuery<{ errors: number; unresolved: number; facts: number }>(`SELECT (SELECT count(*)::int FROM import_staging_rows WHERE batch_id=$1 AND status='ERROR' AND action<>'SKIP') AS errors,(SELECT count(*)::int FROM import_reference_resolutions x JOIN import_staging_rows r ON r.id=x.staging_row_id WHERE x.batch_id=$1 AND x.status<>'EXACT_MATCH' AND r.action<>'SKIP') AS unresolved,(SELECT count(*)::int FROM import_business_facts WHERE batch_id=$1 AND status IN ('REQUIRES_CONFIRMATION','CONFLICT')) AS facts`, [batchId]);
  if (Number(blocking.errors) > 0) throw new Error("仍有红色错误，不能确认导入");
  if (Number(blocking.unresolved) > 0) throw new Error("仍有关联候选未逐项确认，请先完成选择或跳过对应行");
  if (String(batch.scope_type) !== "PENDING" && Number(blocking.facts) > 0) throw new Error("仍有低置信度业务识别项需要确认或忽略");
  await runTransaction([
    { query: `UPDATE import_staging_rows SET status='CONFIRMED',updated_at=now() WHERE batch_id=$1 AND status='WARNING'`, params: [batchId] },
    { query: `UPDATE import_batches SET confirmed_at=now(),status='READY_TO_IMPORT',updated_at=now() WHERE id=$1`, params: [batchId] },
    { query: `INSERT INTO audit_logs(company_id,user_id,object_type,object_id,action,after,ip) VALUES($1,$2,'import_batch',$3,'CONFIRM_REAL_IMPORT',jsonb_build_object('batch_number',$4::text),'127.0.0.1')`, params: [batch.company_id, user.id, batchId, batch.batch_number] },
  ]);
}

export async function importMigrationBatch(batchId: number, user: SessionUser) {
  const batch = await requireBatch(batchId, user); assertCan(user, "imports", "write"); const resource = String(batch.business_type) as ResourceKey;
  if (user.role !== "owner") assertCan(user, resource, "write");
  if (String(batch.status) !== "READY_TO_IMPORT") throw new Error("批次尚未完成人工确认");
  if (String(batch.scope_type) === "PROJECT" && (!batch.project_id || !Boolean(batch.context_confirmed))) throw new Error("PROJECT_CONTEXT_REQUIRED");
  if (String(batch.scope_type) === "PROJECT" && !batch.company_id) throw new Error("项目尚未补充所属公司，只能完成分析和暂存，不能写入正式业务表");
  const rows = await sqlQuery<{ id: number; projectId: number | null; fileId: number; sheetId: number; sourceRow: number; normalizedData: Record<string, unknown>; rawData: Record<string, unknown>; filename: string; sheetName: string }>(`SELECT r.id,r.project_id AS "projectId",f.id AS "fileId",s.id AS "sheetId",r.source_row AS "sourceRow",r.normalized_data AS "normalizedData",r.raw_data AS "rawData",f.filename,s.name AS "sheetName" FROM import_staging_rows r JOIN import_sheets s ON s.id=r.sheet_id JOIN import_files f ON f.id=s.file_id WHERE r.batch_id=$1 AND r.status IN ('READY','CONFIRMED') AND r.action='CREATE' ORDER BY r.source_row`, [batchId]);
  if (batch.project_id && rows.some((row) => Number(row.projectId) !== Number(batch.project_id))) throw new Error("项目隔离校验失败：暂存数据与批次项目不一致");
  await sqlQuery(`UPDATE import_staging_rows SET status='SKIPPED',updated_at=now() WHERE batch_id=$1 AND action<>'CREATE'`, [batchId]);
  if (!rows.length) { await sqlQuery(`UPDATE import_batches SET status='COMPLETED',skipped_rows=total_rows,completed_at=now(),updated_at=now() WHERE id=$1`, [batchId]); return { successRows: 0, skippedRows: Number(batch.total_rows) }; }
  const normalized = rows.map((row) => jsonValue(row.normalizedData, {})); const checked = await preflightImport(resource, normalized, user, { ownerMigration: true });
  if (checked.errors.length) throw new Error(`正式写入前复检失败：${checked.errors.slice(0, 3).map((error) => `第${error.row}行 ${error.message}`).join("；")}`);
  const lineage: MigrationLineageInput[] = rows.map((row) => ({ stagingId: Number(row.id), projectId: row.projectId === null ? null : Number(row.projectId), fileId: Number(row.fileId), sheetId: Number(row.sheetId), filename: row.filename, sheetName: row.sheetName, sourceRow: Number(row.sourceRow), rawData: jsonValue(row.rawData, {}) }));
  try { return await importRowsAtomic(resource, normalized, rows[0].filename, checked.sourceHash, checked.companyId, user, { batchId, stagingRows: lineage }); }
  catch (error) { await sqlQuery(`UPDATE import_batches SET status='READY_TO_IMPORT',error_message=$1,updated_at=now() WHERE id=$2`, [error instanceof Error ? error.message : "正式导入失败", batchId]); throw error; }
}

const rollbackChecks: Partial<Record<ResourceKey, { table: string; checks: [string, string][] }>> = {
  accounts: { table: "company_accounts", checks: [["receipts", "account_id"], ["payment_requests", "account_id"], ["payments", "account_id"]] },
  customers: { table: "customers", checks: [["projects", "customer_id"], ["invoices", "customer_id"]] },
  suppliers: { table: "suppliers", checks: [["supplier_quotes", "supplier_id"], ["purchase_requests", "supplier_id"], ["purchase_orders", "supplier_id"], ["payables", "supplier_id"], ["invoices", "supplier_id"]] },
  projects: { table: "projects", checks: [["contracts", "project_id"], ["skus", "project_id"], ["purchase_requests", "project_id"], ["receivable_plans", "project_id"]] },
  contracts: { table: "contracts", checks: [["receivable_plans", "contract_id"]] },
  receivables: { table: "receivable_plans", checks: [["receipts", "receivable_plan_id"], ["invoice_allocations", "receivable_plan_id"]] },
  skus: { table: "skus", checks: [["supplier_quotes", "sku_id"], ["purchase_request_items", "sku_id"], ["inventory_batches", "sku_id"]] },
  quotes: { table: "supplier_quotes", checks: [["purchase_request_items", "quote_id"]] },
  "purchase-requests": { table: "purchase_requests", checks: [["purchase_orders", "request_id"]] },
  payables: { table: "payables", checks: [["payment_requests", "payable_id"], ["payments", "payable_id"], ["invoice_allocations", "payable_id"], ["purchase_returns", "payable_id"]] },
  invoices: { table: "invoices", checks: [["invoice_allocations", "invoice_id"]] },
  receipts: { table: "receipts", checks: [] }, payments: { table: "payments", checks: [] },
};

export async function rollbackMigrationBatch(batchId: number, user: SessionUser) {
  const batch = await requireBatch(batchId, user); assertCan(user, "imports", "write"); const resource = String(batch.business_type) as ResourceKey;
  if (String(batch.status) !== "COMPLETED") throw new Error("只有已完成批次可以撤销");
  const policy = rollbackChecks[resource]; if (!policy) throw new Error("该业务类型暂不支持自动撤销，请人工处理");
  const records = await sqlQuery<{ targetId: number }>(`SELECT target_id AS "targetId" FROM import_data_lineage WHERE batch_id=$1 AND target_table=$2 ORDER BY id DESC`, [batchId, policy.table]); const blocked: string[] = [];
  for (const record of records) for (const [table, column] of policy.checks) {
    const [row] = await sqlQuery<{ count: number }>(`SELECT count(*)::int AS count FROM ${table} WHERE ${column}=$1`, [record.targetId]); if (Number(row.count) > 0) blocked.push(`${policy.table}#${record.targetId} 已被 ${table} 引用`);
  }
  if (blocked.length) return { ok: false, blocked };
  const statements: TransactionStatement[] = [];
  for (const record of records) {
    if (resource === "projects") statements.push({ query: `DELETE FROM project_budget_versions WHERE project_id=$1`, params: [record.targetId] });
    if (resource === "purchase-requests") statements.push({ query: `DELETE FROM purchase_request_items WHERE request_id=$1`, params: [record.targetId] });
    if (resource === "receipts") statements.push({ query: `UPDATE receivable_plans r SET received_cents=GREATEST(0,r.received_cents-x.amount_cents),status=CASE WHEN GREATEST(0,r.received_cents-x.amount_cents)=0 THEN '未到期' ELSE '部分收款' END FROM receipts x WHERE x.id=$1 AND r.id=x.receivable_plan_id`, params: [record.targetId] }, { query: `UPDATE company_accounts a SET balance_cents=a.balance_cents-x.amount_cents FROM receipts x WHERE x.id=$1 AND a.id=x.account_id`, params: [record.targetId] });
    if (resource === "payments") statements.push({ query: `UPDATE payables y SET paid_cents=GREATEST(0,y.paid_cents-x.amount_cents),status=CASE WHEN GREATEST(0,y.paid_cents-x.amount_cents)=0 THEN '待付' ELSE '部分付款' END FROM payments x WHERE x.id=$1 AND y.id=x.payable_id`, params: [record.targetId] }, { query: `UPDATE company_accounts a SET balance_cents=a.balance_cents+x.amount_cents FROM payments x WHERE x.id=$1 AND a.id=x.account_id`, params: [record.targetId] });
    statements.push({ query: `DELETE FROM ${policy.table} WHERE id=$1`, params: [record.targetId] });
  }
  statements.push({ query: `UPDATE import_staging_rows SET status='ROLLED_BACK',updated_at=now() WHERE batch_id=$1 AND status='IMPORTED'`, params: [batchId] }, { query: `UPDATE import_jobs SET status='已撤销' WHERE migration_batch_id=$1`, params: [batchId] }, { query: `UPDATE import_batches SET status='ROLLED_BACK',rolled_back_at=now(),updated_at=now() WHERE id=$1`, params: [batchId] }, { query: `INSERT INTO audit_logs(company_id,user_id,object_type,object_id,action,after,ip) VALUES($1,$2,'import_batch',$3,'ROLLBACK',jsonb_build_object('batch_number',$4::text),'127.0.0.1')`, params: [batch.company_id, user.id, batchId, batch.batch_number] });
  await runTransaction(statements); return { ok: true, blocked: [] as string[] };
}

export function suggestedMappings(resource: string, headers: string[]) { return suggestFieldMappings(resource, headers); }
