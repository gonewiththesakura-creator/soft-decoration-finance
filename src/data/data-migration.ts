import { createHash } from "node:crypto";
import * as XLSX from "xlsx";
import { runTransaction, sqlQuery, type TransactionStatement } from "@/db/client";
import type { SessionUser } from "@/lib/auth";
import { assertCan, type ResourceKey } from "@/lib/permissions";
import { importRowsAtomic, preflightImport, type MigrationLineageInput } from "./excel-import";
import {
  applyFieldMapping, duplicateRules, migrationDefinition, normalizeHeader, sheetSignature, suggestFieldMappings,
  validateMigrationRow, type MigrationIssue, type ReferenceEntity,
} from "./data-migration-rules";

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
  if (!batch || !scopeAllowed(user, batch.company_id === null ? null : Number(batch.company_id))) throw new Error("批次不存在或超出公司权限范围");
  return batch;
}

async function loadCatalog(user: SessionUser) {
  const entries = await Promise.all(Object.entries(entityQueries).map(async ([entity, query]) => [entity, await sqlQuery<Omit<Candidate, "aliases">>(query)] as const));
  const aliases = await sqlQuery<{ entityType: ReferenceEntity; entityId: number; alias: string; companyId: number }>(`SELECT entity_type AS "entityType",entity_id AS "entityId",alias,company_id AS "companyId" FROM entity_aliases`);
  return Object.fromEntries(entries.map(([entity, rows]) => [entity, rows.filter((row) => scopeAllowed(user, Number(row.companyId))).map((row) => ({ ...row, id: Number(row.id), companyId: Number(row.companyId), aliases: aliases.filter((alias) => alias.entityType === entity && Number(alias.entityId) === Number(row.id)).map((alias) => alias.alias) }))])) as Record<ReferenceEntity, Candidate[]>;
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

export async function createMigrationWorkbook(file: File, user: SessionUser) {
  assertCan(user, "imports", "write");
  if (!/\.xlsx?$/i.test(file.name)) throw new Error("仅支持 .xlsx / .xls 文件");
  if (file.size > 30 * 1024 * 1024) throw new Error("历史迁移文件不能超过 30MB");
  const bytes = Buffer.from(await file.arrayBuffer()); const fileHash = createHash("sha256").update(bytes).digest("hex");
  const book = XLSX.read(bytes, { type: "buffer", cellDates: false });
  if (!book.SheetNames.length) throw new Error("工作簿中没有 Sheet");
  const sheets = book.SheetNames.map((name, index) => {
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(book.Sheets[name], { defval: "", raw: true });
    if (rows.length > 10_000) throw new Error(`Sheet“${name}”超过 10,000 行，请拆分后迁移`);
    const headers = rows.length ? Object.keys(rows[0]) : [];
    return { index, name, rows, headers, rowCount: rows.length, columnCount: headers.length, previewRows: rows.slice(0, 10), signature: sheetSignature(headers) };
  });
  const batchNumber = await nextBatchNumber();
  const duplicate = await sqlQuery<{ batchNumber: string }>(`SELECT batch_number AS "batchNumber" FROM import_batches WHERE source_hash=$1 AND status='COMPLETED' LIMIT 1`, [fileHash]);
  const statements: TransactionStatement[] = [
    { query: `INSERT INTO import_batches(batch_number,company_id,user_id,source_hash,status) VALUES($1,$2,$3,$4,'UPLOADED') RETURNING id`, params: [batchNumber, user.companyId, user.id, fileHash] },
    { query: `INSERT INTO import_files(batch_id,filename,file_size,file_hash,sheet_count) VALUES($1,$2,$3,$4,$5) RETURNING id`, params: [{ fromResult: 0, key: "id" }, file.name, file.size, fileHash, sheets.length] },
  ];
  for (const sheet of sheets) statements.push({ query: `INSERT INTO import_sheets(batch_id,file_id,sheet_index,name,row_count,column_count,headers,preview_rows,raw_rows) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb) RETURNING id`, params: [{ fromResult: 0, key: "id" }, { fromResult: 1, key: "id" }, sheet.index, sheet.name, sheet.rowCount, sheet.columnCount, JSON.stringify(sheet.headers), JSON.stringify(sheet.previewRows), JSON.stringify(sheet.rows)] });
  const results = await runTransaction<{ id: number }>(statements); const batchId = Number(results[0][0].id);
  const templates = await sqlQuery<{ id: number; name: string; businessType: string; signature: string; mappings: Record<string, string> }>(`SELECT id,name,business_type AS "businessType",sheet_signature AS signature,field_mappings AS mappings FROM import_mapping_templates WHERE company_id IS NULL OR company_id=$1`, [user.companyId]);
  return {
    batchId, batchNumber, filename: file.name, fileSize: file.size, sheetCount: sheets.length,
    duplicateOf: duplicate[0]?.batchNumber ?? null,
    sheets: sheets.map((sheet, index) => ({ id: Number(results[index + 2][0].id), name: sheet.name, rowCount: sheet.rowCount, columnCount: sheet.columnCount, headers: sheet.headers, previewRows: sheet.previewRows, matchedTemplate: templates.find((template) => template.signature === sheet.signature) ?? null })),
  };
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
  if (existing) {
    await sqlQuery(`UPDATE import_mapping_templates SET name=$1,source_fields=$2::jsonb,field_mappings=$3::jsonb,updated_at=now(),updated_by=$4 WHERE id=$5`, [name, JSON.stringify(headers), JSON.stringify(mappings), user.id, existing.id]);
    return Number(existing.id);
  }
  const [created] = await sqlQuery<{ id: number }>(`INSERT INTO import_mapping_templates(company_id,name,business_type,sheet_signature,source_fields,field_mappings,created_by) VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7) RETURNING id`, [user.companyId, name, businessType, signature, JSON.stringify(headers), JSON.stringify(mappings), user.id]);
  return Number(created.id);
}

export async function stageMigrationBatch(input: { batchId: number; sheetId: number; businessType: ResourceKey; mappings: Record<string, string>; saveTemplateName?: string }, user: SessionUser) {
  const batch = await requireBatch(input.batchId, user); assertCan(user, "imports", "write"); assertCan(user, input.businessType, "write");
  if (["COMPLETED", "ROLLED_BACK"].includes(String(batch.status))) throw new Error("已完成或已撤销的批次不能重新暂存");
  const definition = migrationDefinition(input.businessType); if (!definition) throw new Error("不支持的业务类型");
  const [sheet] = await sqlQuery<{ id: number; headers: string[]; rawRows: Record<string, unknown>[] }>(`SELECT id,headers,raw_rows AS "rawRows" FROM import_sheets WHERE id=$1 AND batch_id=$2`, [input.sheetId, input.batchId]);
  if (!sheet) throw new Error("Sheet 不存在");
  const headers = jsonValue(sheet.headers, [] as string[]); const rawRows = jsonValue(sheet.rawRows, [] as Record<string, unknown>[]);
  const mappedTargets = new Set(Object.values(input.mappings).filter(Boolean));
  const missing = definition.fields.filter((field) => field.required && !mappedTargets.has(field.key));
  if (missing.length) throw new Error(`缺少必填字段映射：${missing.map((field) => field.displayLabel).join("、")}`);
  const catalog = await loadCatalog(user); const duplicates = await existingDuplicates(input.businessType); const seen = new Set<string>();
  const staged = rawRows.map((raw, index) => {
    const normalized = applyFieldMapping(input.businessType, raw, input.mappings); const issues: MigrationIssue[] = []; const resolutions: Resolution[] = [];
    let companyId = user.companyId;
    for (const field of definition.fields.filter((item) => item.reference === "company")) {
      const value = String(normalized[field.key] ?? ""); const resolution = { ...resolveReference("company", value, catalog.company, null), fieldKey: field.key }; resolutions.push(resolution);
      if (resolution.resolvedEntityId) { normalized[field.key] = resolution.resolvedEntityId; companyId = resolution.resolvedEntityId; }
    }
    for (const field of definition.fields.filter((item) => item.reference && item.reference !== "company")) {
      const value = String(normalized[field.key] ?? ""); if (!value && !field.required) continue;
      const resolution = { ...resolveReference(field.reference!, value, catalog[field.reference!], companyId), fieldKey: field.key }; resolutions.push(resolution);
      if (resolution.resolvedEntityId) { normalized[field.key] = resolution.resolvedEntityId; companyId ??= resolution.candidates[0]?.companyId ?? null; }
    }
    for (const resolution of resolutions.filter((item) => item.status !== "EXACT_MATCH")) {
      const severity = resolution.status === "POSSIBLE_MATCH" ? "WARNING" : "ERROR";
      const messages: Record<ResolutionStatus, string> = { EXACT_MATCH: "精确匹配", POSSIBLE_MATCH: "存在一个可能匹配项，请人工确认", NOT_FOUND: "未找到关联对象", MULTIPLE_MATCHES: "存在多个匹配项，请人工选择" };
      issues.push({ field: definition.fields.find((field) => field.key === resolution.fieldKey)?.displayLabel ?? resolution.fieldKey, severity, code: resolution.status, message: messages[resolution.status] });
    }
    issues.push(...validateMigrationRow(input.businessType, normalized));
    for (const key of Object.keys(normalized).filter((key) => key.endsWith("Yuan") && key !== "balanceYuan")) if (!(Number(normalized[key]) > 0)) issues.push({ field: definition.fields.find((field) => field.key === key)?.displayLabel ?? key, severity: "ERROR", code: "FINANCIAL_AMOUNT", message: "业务金额必须大于 0" });
    if (!scopeAllowed(user, companyId)) issues.push({ field: "公司范围", severity: "ERROR", code: "SCOPE", message: "不能迁移其他公司数据" });
    const rule = duplicateRules[input.businessType]; let duplicateStatus = "NEW"; let duplicateTargetId: number | null = null; let action = "CREATE";
    if (rule) {
      const value = String(normalized[rule.field] ?? ""); const scopeId = rule.companyScoped ? companyId : rule.scopeField ? normalized[rule.scopeField] : "global"; const key = `${scopeId}:${normalizeHeader(value)}`;
      if (seen.has(key)) { duplicateStatus = "POSSIBLE_DUPLICATE"; action = "SKIP"; issues.push({ field: rule.field, severity: "ERROR", code: "FILE_DUPLICATE", message: "文件内存在重复唯一值" }); }
      else seen.add(key);
      if (duplicates.has(key)) { duplicateStatus = "EXISTING"; duplicateTargetId = duplicates.get(key)!; action = rule.financial ? "SKIP" : "MATCH"; issues.push({ field: rule.field, severity: "WARNING", code: "EXISTING", message: rule.financial ? "财务事实已存在，默认跳过且禁止覆盖" : "基础资料已存在，默认匹配现有记录" }); }
    }
    const status = issues.some((issue) => issue.severity === "ERROR") ? "ERROR" : issues.length ? "WARNING" : "READY";
    return { sourceRow: index + 2, raw, normalized, issues, resolutions, status, duplicateStatus, duplicateTargetId, action };
  });
  const eligible = staged.map((row, index) => ({ row, index })).filter(({ row }) => row.action === "CREATE" && !row.issues.some((issue) => issue.severity === "ERROR"));
  if (eligible.length) {
    const businessPreflight = await preflightImport(input.businessType, eligible.map(({ row }) => row.normalized), user);
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
      statements.push({ query: `INSERT INTO import_staging_rows(batch_id,sheet_id,source_row,raw_data,normalized_data,issues,duplicate_status,duplicate_target_id,action,status) VALUES($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb,$7,$8,$9,$10) RETURNING id`, params: [input.batchId, input.sheetId, row.sourceRow, JSON.stringify(row.raw), JSON.stringify(row.normalized), JSON.stringify(row.issues), row.duplicateStatus, row.duplicateTargetId, row.action, row.status] });
      for (const resolution of row.resolutions) statements.push({ query: `INSERT INTO import_reference_resolutions(batch_id,staging_row_id,field_key,entity_type,input_value,status,resolved_entity_id,candidates) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`, params: [input.batchId, { fromResult: resultIndex, key: "id" }, resolution.fieldKey, resolution.entityType, resolution.inputValue, resolution.status, resolution.resolvedEntityId, JSON.stringify(resolution.candidates.slice(0, 8))] });
    }
    await runTransaction(statements);
  }
  const counts = { ready: staged.filter((row) => row.status === "READY").length, warning: staged.filter((row) => row.status === "WARNING").length, error: staged.filter((row) => row.status === "ERROR").length };
  const mappingTemplateId = input.saveTemplateName?.trim() ? await saveMappingTemplate(user, input.saveTemplateName.trim(), input.businessType, headers, input.mappings) : null;
  await sqlQuery(`UPDATE import_sheets SET selected=(id=$1) WHERE batch_id=$2`, [input.sheetId, input.batchId]);
  await sqlQuery(`UPDATE import_batches SET business_type=$1,mapping_template_id=$2,total_rows=$3,ready_rows=$4,warning_rows=$5,error_rows=$6,status='VALIDATED',error_message=NULL,updated_at=now() WHERE id=$7`, [input.businessType, mappingTemplateId, staged.length, counts.ready, counts.warning, counts.error, input.batchId]);
  return { ...counts, total: staged.length };
}

export async function getMigrationOverview(user: SessionUser) {
  assertCan(user, "imports"); const scope = user.role === "owner" ? { sql: "TRUE", params: [] as unknown[] } : { sql: "b.company_id=$1", params: [user.companyId] as unknown[] };
  const batches = await sqlQuery<Record<string, unknown>>(`SELECT b.id,b.batch_number AS "batchNumber",b.business_type AS "businessType",b.source_hash AS "sourceHash",b.status,b.total_rows AS "totalRows",b.ready_rows AS "readyRows",b.warning_rows AS "warningRows",b.error_rows AS "errorRows",b.success_rows AS "successRows",b.skipped_rows AS "skippedRows",b.created_at AS "createdAt",f.filename,s.name AS "sheetName",m.name AS "mappingName",u.name AS "userName" FROM import_batches b LEFT JOIN import_files f ON f.batch_id=b.id LEFT JOIN import_sheets s ON s.batch_id=b.id AND s.selected LEFT JOIN import_mapping_templates m ON m.id=b.mapping_template_id JOIN users u ON u.id=b.user_id WHERE ${scope.sql} ORDER BY b.created_at DESC LIMIT 30`, scope.params);
  const [summary] = await sqlQuery<Record<string, unknown>>(`SELECT (SELECT count(*)::int FROM projects) AS projects,(SELECT count(*)::int FROM suppliers) AS suppliers,(SELECT count(*)::int FROM skus) AS skus,(SELECT count(*)::int FROM purchase_orders) AS purchases,(SELECT count(*)::int FROM payments WHERE NOT is_void) AS payments`);
  return { batches, summary };
}

export async function getMigrationBatch(batchId: number, user: SessionUser, page = 1) {
  const batch = await requireBatch(batchId, user); const pageSize = 50; const offset = Math.max(0, page - 1) * pageSize;
  const [file] = await sqlQuery<Record<string, unknown>>(`SELECT filename,file_size AS "fileSize",sheet_count AS "sheetCount" FROM import_files WHERE batch_id=$1`, [batchId]);
  const sheets = await sqlQuery<Record<string, unknown>>(`SELECT id,name,row_count AS "rowCount",column_count AS "columnCount",headers,preview_rows AS "previewRows",selected FROM import_sheets WHERE batch_id=$1 ORDER BY sheet_index`, [batchId]);
  const rows = await sqlQuery<Record<string, unknown>>(`SELECT id,source_row AS "sourceRow",normalized_data AS "normalizedData",issues,duplicate_status AS "duplicateStatus",duplicate_target_id AS "duplicateTargetId",action,status,target_table AS "targetTable",target_id AS "targetId" FROM import_staging_rows WHERE batch_id=$1 ORDER BY source_row LIMIT $2 OFFSET $3`, [batchId, pageSize, offset]);
  const resolutions = await sqlQuery<Record<string, unknown>>(`SELECT x.id,x.staging_row_id AS "stagingRowId",x.field_key AS "fieldKey",x.entity_type AS "entityType",x.input_value AS "inputValue",x.status,x.resolved_entity_id AS "resolvedEntityId",x.candidates FROM import_reference_resolutions x WHERE x.staging_row_id IN (SELECT id FROM import_staging_rows WHERE batch_id=$1 ORDER BY source_row LIMIT $2 OFFSET $3) AND x.status<>'EXACT_MATCH' ORDER BY x.staging_row_id,x.id`, [batchId, pageSize, offset]);
  const [blocking] = await sqlQuery<{ unresolved: number }>(`SELECT count(*)::int AS unresolved FROM import_reference_resolutions x JOIN import_staging_rows r ON r.id=x.staging_row_id WHERE x.batch_id=$1 AND x.status<>'EXACT_MATCH' AND r.action<>'SKIP'`, [batchId]);
  return { batch, file, sheets, rows, resolutions, unresolvedReferences: Number(blocking.unresolved), page, pageSize };
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

export async function confirmMigrationBatch(batchId: number, user: SessionUser) {
  const batch = await requireBatch(batchId, user); assertCan(user, "imports", "write");
  if (String(batch.status) !== "VALIDATED") throw new Error("当前批次不处于人工确认阶段");
  const [blocking] = await sqlQuery<{ errors: number; unresolved: number }>(`SELECT (SELECT count(*)::int FROM import_staging_rows WHERE batch_id=$1 AND status='ERROR' AND action<>'SKIP') AS errors,(SELECT count(*)::int FROM import_reference_resolutions x JOIN import_staging_rows r ON r.id=x.staging_row_id WHERE x.batch_id=$1 AND x.status<>'EXACT_MATCH' AND r.action<>'SKIP') AS unresolved`, [batchId]);
  if (Number(blocking.errors) > 0) throw new Error("仍有红色错误，不能确认导入");
  if (Number(blocking.unresolved) > 0) throw new Error("仍有关联候选未逐项确认，请先完成选择或跳过对应行");
  await runTransaction([{ query: `UPDATE import_staging_rows SET status='CONFIRMED',updated_at=now() WHERE batch_id=$1 AND status='WARNING'`, params: [batchId] }, { query: `UPDATE import_batches SET confirmed_at=now(),status='READY_TO_IMPORT',updated_at=now() WHERE id=$1`, params: [batchId] }]);
}

export async function importMigrationBatch(batchId: number, user: SessionUser) {
  const batch = await requireBatch(batchId, user); assertCan(user, "imports", "write"); const resource = String(batch.business_type) as ResourceKey; assertCan(user, resource, "write");
  if (String(batch.status) !== "READY_TO_IMPORT") throw new Error("批次尚未完成人工确认");
  const rows = await sqlQuery<{ id: number; sourceRow: number; normalizedData: Record<string, unknown>; rawData: Record<string, unknown>; filename: string; sheetName: string }>(`SELECT r.id,r.source_row AS "sourceRow",r.normalized_data AS "normalizedData",r.raw_data AS "rawData",f.filename,s.name AS "sheetName" FROM import_staging_rows r JOIN import_sheets s ON s.id=r.sheet_id JOIN import_files f ON f.id=s.file_id WHERE r.batch_id=$1 AND r.status IN ('READY','CONFIRMED') AND r.action='CREATE' ORDER BY r.source_row`, [batchId]);
  await sqlQuery(`UPDATE import_staging_rows SET status='SKIPPED',updated_at=now() WHERE batch_id=$1 AND action<>'CREATE'`, [batchId]);
  if (!rows.length) { await sqlQuery(`UPDATE import_batches SET status='COMPLETED',skipped_rows=total_rows,completed_at=now(),updated_at=now() WHERE id=$1`, [batchId]); return { successRows: 0, skippedRows: Number(batch.total_rows) }; }
  const normalized = rows.map((row) => jsonValue(row.normalizedData, {})); const checked = await preflightImport(resource, normalized, user);
  if (checked.errors.length) throw new Error(`正式写入前复检失败：${checked.errors.slice(0, 3).map((error) => `第${error.row}行 ${error.message}`).join("；")}`);
  const lineage: MigrationLineageInput[] = rows.map((row) => ({ stagingId: Number(row.id), filename: row.filename, sheetName: row.sheetName, sourceRow: Number(row.sourceRow), rawData: jsonValue(row.rawData, {}) }));
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
