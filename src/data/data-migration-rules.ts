import type { ResourceKey } from "@/lib/permissions";
import { importDefinitions, type ImportField } from "./excel";

export type MigrationSeverity = "WARNING" | "ERROR";
export type MigrationIssue = { field: string; severity: MigrationSeverity; code: string; message: string };
export type ReferenceEntity = "company" | "customer" | "project" | "supplier" | "sku" | "contract" | "account" | "receivable" | "purchase_order" | "payable";
export type MigrationField = ImportField & { aliases: string[]; reference?: ReferenceEntity; displayLabel: string };
export type MigrationDefinition = { resource: ResourceKey; label: string; fields: MigrationField[] };
export type SemanticMappingSuggestion = { sourceField: string; targetField: string; confidence: number; reason: string };
export interface SemanticMappingProvider { suggest(resource: ResourceKey, headers: string[], sampleRows: Record<string, unknown>[]): Promise<SemanticMappingSuggestion[]>; }

const aliases: Record<string, string[]> = {
  companyId: ["公司", "公司名称", "公司编码", "所属公司", "核算主体", "主体"],
  customerId: ["客户", "客户名称", "客户编码", "甲方", "客户单位", "业主单位"],
  projectId: ["项目", "项目名称", "项目编号", "工程名称", "工程编号"],
  supplierId: ["供应商", "供应商名称", "供应商编码", "厂家", "供货商", "厂商"],
  skuId: ["SKU", "SKU编码", "产品编码", "物料编码"],
  contractId: ["合同", "合同编号", "合同名称"],
  accountId: ["账户", "账户名称", "银行账户", "账户尾号"],
  receivablePlanId: ["应收节点", "应收节点名称", "收款节点"],
  purchaseOrderId: ["采购单", "采购单编号", "订单编号"],
  payableId: ["应付", "应付编号", "付款节点编号"],
  code: ["编码", "编号"],
  name: ["名称"],
  legalRepresentative: ["法人", "法人代表", "法定代表人"],
  category: ["分类", "产品分类", "主营品类"],
  type: ["类型", "类别"],
  contact: ["联系人", "对接人"],
  phone: ["电话", "手机号", "联系电话"],
  taxNumber: ["税号", "纳税人识别号"],
  address: ["地址", "项目地址", "工程地址"],
  contractYuan: ["合同金额", "项目金额", "签约金额"],
  budgetYuan: ["采购预算", "预算金额", "预算"],
  amountYuan: ["金额", "含税金额", "应收金额", "应付金额", "付款金额", "收款金额", "申请金额", "票面金额", "已核价金额", "已收款", "已打款"],
  budgetUnitYuan: ["预算单价", "预算价"],
  unitPriceYuan: ["采购价", "采购单价", "含税单价", "核价", "最终采购价", "最终采购单价", "核价后金额"],
  freightYuan: ["运费", "物流费"],
  installYuan: ["安装费", "安装金额"],
  ratioPercent: ["比例", "收款比例", "应收比例"],
  taxRatePercent: ["税率", "税点"],
  quantity: ["数量", "采购数量", "产品数量"],
  room: ["房间", "空间", "房间区域", "区域"],
  unit: ["单位", "计量单位"],
  brand: ["品牌", "厂家品牌"],
  paymentTerms: ["付款条件", "付款条款"],
  paymentNode: ["付款节点", "应付节点"],
  paymentType: ["付款类型", "支付类型"],
  invoiceStatus: ["发票状态", "票据状态"],
  direction: ["发票方向", "进销项"],
  number: ["业务编号", "单据编号", "编号"],
  startDate: ["开始日期", "开工日期"],
  expectedEndDate: ["预计完成日期", "预计完工日期", "结束日期"],
  signedAt: ["签约日期", "合同日期"],
  dueDate: ["到期日期", "应收日期", "应付日期", "预计收款日期"],
  receivedAt: ["到账日期", "收款日期"],
  paidAt: ["付款日期", "支付日期"],
  issuedAt: ["开票日期", "发票日期"],
  isWarranty: ["是否质保金", "质保金"],
};

const references: Partial<Record<string, ReferenceEntity>> = {
  companyId: "company", customerId: "customer", projectId: "project", supplierId: "supplier", skuId: "sku", contractId: "contract",
  accountId: "account", receivablePlanId: "receivable", purchaseOrderId: "purchase_order", payableId: "payable",
};

const referenceLabels: Partial<Record<string, string>> = {
  companyId: "公司名称 / 编码", customerId: "客户名称 / 编码", projectId: "项目名称 / 编号", supplierId: "供应商名称 / 编码",
  skuId: "SKU 编码", contractId: "合同编号", accountId: "账户名称 / 尾号", receivablePlanId: "应收节点名称",
  purchaseOrderId: "采购单编号", payableId: "应付编号",
};

export const migrationDefinitions: MigrationDefinition[] = importDefinitions.map((definition) => ({
  resource: definition.resource,
  label: definition.label,
  fields: definition.fields.map((field) => ({
    ...field,
    displayLabel: referenceLabels[field.key] ?? field.label.replace(/\(元\)|\(%\)/g, ""),
    reference: references[field.key],
    aliases: Array.from(new Set([
      field.label, field.label.replace(/\(元\)|\(%\)/g, ""), ...(aliases[field.key] ?? []),
      ...(definition.resource === "customers" && field.key === "name" ? ["客户", "甲方", "客户单位", "业主单位"] : []),
      ...(definition.resource === "suppliers" && field.key === "name" ? ["供应商", "厂家", "供货商", "厂商"] : []),
      ...(definition.resource === "projects" && field.key === "name" ? ["项目", "工程名称"] : []),
    ])),
  })),
}));

export function migrationDefinition(resource: string) { return migrationDefinitions.find((item) => item.resource === resource); }
export function normalizeHeader(value: unknown) { return String(value ?? "").trim().replace(/[\s_\-（）()]/g, "").toLowerCase(); }
export function sheetSignature(headers: string[]) { return headers.map(normalizeHeader).sort().join("|"); }

export function suggestFieldMappings(resource: string, headers: string[]) {
  const definition = migrationDefinition(resource);
  if (!definition) return {} as Record<string, string>;
  return Object.fromEntries(headers.map((header) => {
    const normalized = normalizeHeader(header);
    const exact = definition.fields.find((field) => field.aliases.some((alias) => normalizeHeader(alias) === normalized));
    return [header, exact?.key ?? ""];
  }));
}

export function parseAmount(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  let input = String(value ?? "").trim();
  if (!input) return null;
  const negative = /^\(.*\)$/.test(input); input = input.replace(/[￥¥,，元\s()]/g, "");
  const multiplier = /万$/.test(input) ? 10_000 : 1; input = input.replace(/万$/, "");
  const parsed = Number(input); return Number.isFinite(parsed) ? (negative ? -1 : 1) * parsed * multiplier : null;
}

export function parseExcelDate(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  if (typeof value === "number" || /^\d+(\.\d+)?$/.test(String(value ?? "").trim())) {
    const serial = Number(value);
    if (serial > 20_000 && serial < 100_000) {
      const date = new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86_400_000);
      return date.toISOString().slice(0, 10);
    }
  }
  const input = String(value ?? "").trim().replace(/[./]/g, "-");
  const match = input.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.getUTCFullYear() === Number(match[1]) && date.getUTCMonth() === Number(match[2]) - 1 && date.getUTCDate() === Number(match[3])
    ? `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}` : null;
}

export function parseRatio(value: unknown) {
  const input = String(value ?? "").trim(); if (!input) return null;
  const parsed = Number(input.replace("%", "")); if (!Number.isFinite(parsed)) return null;
  if (input.includes("%")) return parsed;
  return Math.abs(parsed) <= 1 ? parsed * 100 : parsed;
}

export function parseBooleanValue(value: unknown) {
  if (typeof value === "boolean") return value;
  const input = normalizeHeader(value);
  if (["是", "y", "yes", "true", "1"].includes(input)) return true;
  if (["否", "n", "no", "false", "0"].includes(input)) return false;
  return null;
}

export function parseQuantity(value: unknown) {
  const parsed = Number(String(value ?? "").replace(/,/g, "").trim());
  return Number.isFinite(parsed) && Math.round(parsed * 10_000) === parsed * 10_000 ? parsed : null;
}

export function applyFieldMapping(resource: string, raw: Record<string, unknown>, mappings: Record<string, string>) {
  const definition = migrationDefinition(resource); if (!definition) return {};
  const sourceByTarget = new Map(Object.entries(mappings).filter(([, target]) => target).map(([source, target]) => [target, source]));
  return Object.fromEntries(definition.fields.map((field) => {
    const source = sourceByTarget.get(field.key); const rawValue = source ? raw[source] : "";
    if (field.reference) return [field.key, String(rawValue ?? "").trim()];
    if (field.key.endsWith("Yuan")) return [field.key, parseAmount(rawValue)];
    if (field.key.endsWith("Percent")) return [field.key, parseRatio(rawValue)];
    if (field.type === "date") return [field.key, parseExcelDate(rawValue)];
    if (field.key === "isWarranty") return [field.key, parseBooleanValue(rawValue)];
    if (field.key === "quantity") return [field.key, parseQuantity(rawValue)];
    if (field.type === "number") { const parsed = Number(rawValue); return [field.key, Number.isFinite(parsed) ? parsed : null]; }
    return [field.key, String(rawValue ?? "").trim()];
  }));
}

export function validateMigrationRow(resource: string, row: Record<string, unknown>) {
  const definition = migrationDefinition(resource); const issues: MigrationIssue[] = [];
  if (!definition) return [{ field: "类型", severity: "ERROR", code: "UNSUPPORTED", message: "不支持的业务类型" }] satisfies MigrationIssue[];
  for (const field of definition.fields) {
    const value = row[field.key];
    if (field.required && (value === "" || value === null || value === undefined)) issues.push({ field: field.displayLabel, severity: "ERROR", code: "REQUIRED", message: "必填字段为空或格式无效" });
    if (field.key.endsWith("Yuan") && value !== null && value !== "" && (typeof value !== "number" || !Number.isSafeInteger(Math.round(value * 100)))) issues.push({ field: field.displayLabel, severity: "ERROR", code: "AMOUNT", message: "金额格式无效或超出安全范围" });
    if (field.key === "quantity" && value !== null && (!(Number(value) > 0) || Math.round(Number(value) * 10_000) !== Number(value) * 10_000)) issues.push({ field: field.displayLabel, severity: "ERROR", code: "QUANTITY", message: "数量必须大于 0 且最多 4 位小数" });
    if (field.key.endsWith("Percent") && value !== null && (!(Number(value) >= 0) || Number(value) > 100)) issues.push({ field: field.displayLabel, severity: "ERROR", code: "RATIO", message: "比例必须在 0 到 100 之间" });
  }
  return issues;
}

export const duplicateRules: Partial<Record<ResourceKey, { table: string; field: string; column: string; companyScoped?: boolean; scopeField?: string; scopeColumn?: string; financial?: boolean }>> = {
  companies: { table: "companies", field: "code", column: "code" },
  customers: { table: "customers", field: "code", column: "code", companyScoped: true },
  suppliers: { table: "suppliers", field: "code", column: "code", companyScoped: true },
  projects: { table: "projects", field: "code", column: "code" },
  contracts: { table: "contracts", field: "number", column: "number", financial: true },
  skus: { table: "skus", field: "code", column: "code", scopeField: "projectId", scopeColumn: "project_id" },
  "purchase-requests": { table: "purchase_requests", field: "number", column: "number", financial: true },
  payables: { table: "payables", field: "number", column: "number", financial: true },
  receipts: { table: "receipts", field: "number", column: "number", financial: true },
  payments: { table: "payments", field: "number", column: "number", financial: true },
  invoices: { table: "invoices", field: "number", column: "number", companyScoped: true, financial: true },
};
