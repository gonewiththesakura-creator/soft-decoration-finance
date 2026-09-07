import type { ResourceKey } from "@/lib/permissions";
import { migrationDefinition, normalizeHeader } from "./data-migration-rules";
import type { ParsedSheet } from "./import-pilot";

export type ImportScope = "PENDING" | "PROJECT" | "COMPANY" | "MASTER";
export type ConfidenceLevel = "HIGH" | "MEDIUM" | "LOW" | "CONFLICT";
export type BusinessFactType =
  | "PROJECT" | "CONTRACT" | "PROJECT_COST" | "SKU" | "SUPPLIER" | "CUSTOMER"
  | "PURCHASE_ORDER" | "PURCHASE_ORDER_LINE" | "PAYABLE" | "PAYMENT"
  | "RECEIVABLE" | "RECEIPT" | "INVOICE" | "TAX" | "PAYMENT_TERMS";

export type ProjectCandidate = {
  name: string;
  confidence: number;
  level: ConfidenceLevel;
  sources: string[];
};

export type IntelligentMapping = {
  sourceField: string;
  targetField: string;
  targetLabel: string;
  confidence: number;
  level: ConfidenceLevel;
  reason: string;
};

export type RecognizedBusinessFact = {
  factType: BusinessFactType;
  label: string;
  resource: ResourceKey | null;
  confidence: number;
  level: ConfidenceLevel;
  plannedCount: number;
  sheetIndex: number;
  sheetName: string;
  mappings: IntelligentMapping[];
  warnings: string[];
};

export type IntelligentWorkbookAnalysis = {
  scopeSuggestion: Exclude<ImportScope, "PENDING">;
  projectCandidate: ProjectCandidate | null;
  projectCandidates: ProjectCandidate[];
  facts: RecognizedBusinessFact[];
  overallConfidence: number;
  highConfidenceCount: number;
  needsConfirmationCount: number;
  ignoredColumnCount: number;
};

const factLabels: Record<BusinessFactType, string> = {
  PROJECT: "项目",
  CONTRACT: "合同信息",
  PROJECT_COST: "项目成本",
  SKU: "SKU / 产品明细",
  SUPPLIER: "供应商",
  CUSTOMER: "客户",
  PURCHASE_ORDER: "采购订单",
  PURCHASE_ORDER_LINE: "采购明细",
  PAYABLE: "应付",
  PAYMENT: "付款",
  RECEIVABLE: "应收",
  RECEIPT: "收款",
  INVOICE: "发票 / 开票状态",
  TAX: "税费",
  PAYMENT_TERMS: "付款条件",
};

export const factResources: Partial<Record<BusinessFactType, ResourceKey>> = {
  PROJECT: "projects",
  CONTRACT: "contracts",
  SKU: "skus",
  SUPPLIER: "suppliers",
  CUSTOMER: "customers",
  PURCHASE_ORDER: "purchase-requests",
  PURCHASE_ORDER_LINE: "purchase-requests",
  PAYABLE: "payables",
  PAYMENT: "payments",
  RECEIVABLE: "receivables",
  RECEIPT: "receipts",
  INVOICE: "invoices",
};

const projectScopedFacts = new Set<BusinessFactType>([
  "PROJECT", "CONTRACT", "PROJECT_COST", "SKU", "PURCHASE_ORDER", "PURCHASE_ORDER_LINE",
  "PAYABLE", "PAYMENT", "RECEIVABLE", "RECEIPT", "INVOICE", "TAX", "PAYMENT_TERMS",
]);

type FactRule = {
  factType: BusinessFactType;
  signals: RegExp[];
  minimum: number;
  base: number;
};

const factRules: FactRule[] = [
  { factType: "PROJECT_COST", signals: [/总成本|成本表|项目成本/u, /成本|预算金额|预算价/u, /金额|合计/u], minimum: 2, base: 6500 },
  { factType: "CONTRACT", signals: [/合同/u, /合同金额/u, /签约|甲方/u], minimum: 1, base: 6900 },
  { factType: "SKU", signals: [/sku|饰品|产品明细|物料/u, /品名|产品名称|名称/u, /规格|型号/u, /数量/u, /单价|预算价/u], minimum: 2, base: 5700 },
  { factType: "SUPPLIER", signals: [/供应商|供货商|厂家|厂商/u, /税号|纳税人识别号/u, /联系人|联系电话/u], minimum: 1, base: 6900 },
  { factType: "CUSTOMER", signals: [/客户|甲方|业主单位/u, /客户编码/u, /联系人|联系电话/u], minimum: 1, base: 6800 },
  { factType: "PURCHASE_ORDER", signals: [/采购订单|采购单|下单|采购/u, /订单编号|采购单号/u, /数量/u, /金额|合计/u], minimum: 2, base: 6100 },
  { factType: "PURCHASE_ORDER_LINE", signals: [/品名|产品|sku|物料/u, /数量/u, /单价/u, /金额|合计/u], minimum: 3, base: 5800 },
  { factType: "PAYABLE", signals: [/应付|欠款|货款/u, /付款节点|阶段款/u, /到期|付款日期/u], minimum: 1, base: 6900 },
  { factType: "PAYMENT", signals: [/付款(?!条件|条款)|支付|实付|已打款/u, /付款日期|支付日期/u, /付款方式|支付方式/u], minimum: 1, base: 6800 },
  { factType: "RECEIVABLE", signals: [/应收|收款计划/u, /预计收款|应收日期/u, /收款比例/u], minimum: 1, base: 6900 },
  { factType: "RECEIPT", signals: [/收款|到账|回款/u, /到账日期|收款日期/u, /已收款/u], minimum: 1, base: 6800 },
  { factType: "INVOICE", signals: [/发票|开票|票据/u, /发票号码|票号/u, /是否开票|发票状态/u], minimum: 1, base: 6900 },
  { factType: "TAX", signals: [/增值税|税额|税率|税点/u], minimum: 1, base: 6900 },
  { factType: "PAYMENT_TERMS", signals: [/付款条件|付款条款|支付条件/u], minimum: 1, base: 7200 },
];

export function confidenceLevel(confidence: number): ConfidenceLevel {
  if (confidence >= 9000) return "HIGH";
  if (confidence >= 7000) return "MEDIUM";
  return "LOW";
}

function stripBusinessSuffix(value: string) {
  return value
    .replace(/^[\s._-]*\d+[.、_\-\s]*/u, "")
    .replace(/[\s._-]*(?:\(\d+\)|（\d+）|\d+)[\s._-]*$/u, "")
    .replace(/[（(][^）)]*(?:19|20)\d{2}[^）)]*[）)]/gu, "")
    .replace(/(?:19|20)\d{2}[-./年]\d{1,2}(?:[-./月]\d{1,2}日?)?/gu, "")
    .replace(/(?:更新|修订|终版|最终版|未完结|已完结|副本|copy|rev|v\d+(?:\.\d+)*)/giu, "")
    .replace(/[\s._-]+$/u, "")
    .replace(/(?:项目)?(?:总)?(?:成本|采购|付款|收款|发票|合同|报价|预算|产品|sku)(?:明细|汇总|总)?(?:表|台账)?$/iu, "")
    .replace(/[\s._-]+$/u, "")
    .trim();
}

export function extractProjectCandidate(value: string) {
  const leaf = value.replaceAll("\\", "/").split("/").filter(Boolean).at(-1) ?? value;
  const stem = leaf.replace(/\.(xlsx|xls|csv)$/i, "").normalize("NFKC");
  const candidate = stripBusinessSuffix(stem);
  const invalid = /(?:https?:|www\.|@|email|e-mail|邮箱|电话|传真|手机|联系人|地址|购货方|客户名称|客户编号|订单编号|下单日期|交货时间|交货地点|运输方式|付款方式|成交日期|完成日期|税费|总成交金额)/iu;
  const genericDocument = /^(?:项目)?(?:成本核算|客户订单确认|合同清单|报价清单|采购清单)$/u;
  const digits = [...candidate].filter((character) => /\d/.test(character)).length;
  if (candidate.length < 2 || candidate.length > 80 || invalid.test(candidate) || genericDocument.test(candidate) || /[+,，,]{2,}/u.test(candidate) || (digits > candidate.length / 2 && !/[\p{Script=Han}A-Za-z]{2}/u.test(candidate)) || /^(导入|数据|财务|真实数据|import-drop)$/iu.test(candidate)) return null;
  return candidate.slice(0, 120);
}

export function projectNameKey(value: string) {
  return normalizeHeader(value).replace(/(?:项目|工程)$/u, "");
}

export function projectNamesEquivalent(left: string, right: string) {
  const a = projectNameKey(left); const b = projectNameKey(right);
  return Boolean(a && b && (a === b || (Math.min(a.length, b.length) >= 4 && (a.includes(b) || b.includes(a)))));
}

export function detectProjectConflict(boundProjectName: string, candidate: ProjectCandidate | null) {
  if (!candidate || candidate.confidence < 8000 || projectNamesEquivalent(boundProjectName, candidate.name)) return null;
  return { currentProject: boundProjectName, detectedProject: candidate.name, confidence: candidate.confidence, level: "CONFLICT" as const };
}

function sourceProjectValues(sheet: ParsedSheet) {
  const values: { name: string; confidence: number }[] = [];
  const titles = sheet.titleValues ?? [];
  for (const [index, title] of titles.entries()) {
    const text = String(title).trim();
    const explicit = text.match(/^(?:项目全称|项目名称|项目名|工程名称|工程名)\s*[:：]\s*(.*)$/u);
    if (explicit) {
      const candidate = extractProjectCandidate(explicit[1] || String(titles[index + 1] ?? ""));
      if (candidate) values.push({ name: candidate, confidence: 9900 });
      continue;
    }
    if (!/(?:项目|中心|酒店|公寓|会所|别墅|售楼处|样板间)/u.test(text)) continue;
    const candidate = extractProjectCandidate(text);
    if (candidate) values.push({ name: candidate, confidence: 8800 });
  }
  const projectHeaders = sheet.headers.filter((header) => /^(项目名称|项目名|项目|工程名称|工程名)$/u.test(String(header).trim()));
  for (const row of sheet.rows.slice(0, 100)) for (const header of projectHeaders) {
    const value = String(row[header] ?? "").trim();
    const candidate = extractProjectCandidate(value);
    if (candidate) values.push({ name: candidate, confidence: 9900 });
  }
  return values;
}

function mergeProjectCandidates(entries: { name: string; confidence: number; source: string }[]) {
  const groups: ProjectCandidate[] = [];
  for (const entry of entries) {
    const matched = groups.find((candidate) => projectNamesEquivalent(candidate.name, entry.name));
    if (matched) {
      if (entry.name.length > matched.name.length) matched.name = entry.name;
      matched.confidence = Math.max(matched.confidence, entry.confidence);
      if (!matched.sources.includes(entry.source)) matched.sources.push(entry.source);
      matched.level = confidenceLevel(matched.confidence);
    } else groups.push({ name: entry.name, confidence: entry.confidence, level: confidenceLevel(entry.confidence), sources: [entry.source] });
  }
  return groups.sort((a, b) => b.confidence - a.confidence || b.sources.length - a.sources.length || b.name.length - a.name.length);
}

export function suggestIntelligentMappings(resource: ResourceKey, headers: string[]): IntelligentMapping[] {
  const definition = migrationDefinition(resource); if (!definition) return [];
  const usedTargets = new Set<string>(); const output: IntelligentMapping[] = [];
  for (const header of headers) {
    const source = normalizeHeader(header); if (!source) continue;
    const exact = definition.fields.find((field) => !usedTargets.has(field.key) && field.aliases.some((alias) => normalizeHeader(alias) === source));
    const fuzzy = exact ?? definition.fields.find((field) => !usedTargets.has(field.key) && field.aliases.some((alias) => {
      const target = normalizeHeader(alias); return source.length >= 2 && target.length >= 2 && (source.includes(target) || target.includes(source));
    }));
    if (!fuzzy) continue;
    usedTargets.add(fuzzy.key);
    const confidence = exact ? 9800 : 7600;
    output.push({ sourceField: header, targetField: fuzzy.key, targetLabel: fuzzy.displayLabel, confidence, level: confidenceLevel(confidence), reason: exact ? "字段别名精确匹配" : "字段语义近似匹配，需确认" });
  }
  return output;
}

export function recognizeSheetFacts(sheet: ParsedSheet): RecognizedBusinessFact[] {
  if (sheet.isEmpty) return [];
  const text = normalizeHeader(`${sheet.name} ${sheet.headers.join(" ")}`);
  const facts: RecognizedBusinessFact[] = [];
  const classificationFacts: Partial<Record<string, Set<BusinessFactType>>> = {
    PROJECT_COST: new Set(["PROJECT_COST"]),
    SKU_DETAIL: new Set(["SKU"]),
    SUPPLIER_QUOTE: new Set(["SKU", "SUPPLIER", "TAX", "PAYMENT_TERMS"]),
  };
  const allowedFacts = classificationFacts[sheet.classification];
  for (const rule of factRules) {
    if (allowedFacts && !allowedFacts.has(rule.factType)) continue;
    const matched = rule.signals.filter((signal) => signal.test(text)).length;
    if (matched < rule.minimum) continue;
    const confidence = Math.min(9900, rule.base + matched * 1100 + (sheet.classification !== "UNKNOWN" ? 300 : 0));
    const resource = factResources[rule.factType] ?? null;
    const mappings = resource ? suggestIntelligentMappings(resource, sheet.headers) : [];
    facts.push({
      factType: rule.factType,
      label: factLabels[rule.factType],
      resource,
      confidence,
      level: confidenceLevel(confidence),
      plannedCount: ["PROJECT", "CONTRACT", "PAYMENT_TERMS"].includes(rule.factType) ? 1 : Math.max(1, sheet.rowCount),
      sheetIndex: sheet.index,
      sheetName: sheet.name,
      mappings,
      warnings: mappings.some((mapping) => mapping.level !== "HIGH") ? ["包含需确认的字段映射"] : [],
    });
  }
  return facts.sort((a, b) => b.confidence - a.confidence || a.label.localeCompare(b.label, "zh-CN"));
}

export function analyzeWorkbook(filename: string, sheets: ParsedSheet[], sourcePath?: string): IntelligentWorkbookAnalysis {
  const candidates: { name: string; confidence: number; source: string }[] = [];
  const filenameCandidate = extractProjectCandidate(filename);
  if (filenameCandidate) candidates.push({ name: filenameCandidate, confidence: 9000, source: "文件名" });
  if (sourcePath) {
    const parts = sourcePath.replaceAll("\\", "/").split("/").filter(Boolean);
    const folderCandidate = parts.length > 1 ? extractProjectCandidate(parts.at(-2) ?? "") : null;
    if (folderCandidate) candidates.push({ name: folderCandidate, confidence: 8400, source: "一级目录" });
  }
  for (const sheet of sheets) for (const value of sourceProjectValues(sheet)) candidates.push({ name: value.name, confidence: value.confidence, source: `Sheet“${sheet.name}”内容` });
  const projectCandidates = mergeProjectCandidates(candidates);
  const facts = sheets.flatMap(recognizeSheetFacts);
  const scopeSuggestion = facts.some((fact) => projectScopedFacts.has(fact.factType)) || projectCandidates.length ? "PROJECT"
    : facts.some((fact) => !["SUPPLIER", "CUSTOMER"].includes(fact.factType)) ? "COMPANY" : "MASTER";
  const mappingSuggestions = facts.flatMap((fact) => fact.mappings);
  const confidences = [...facts.map((fact) => fact.confidence), ...mappingSuggestions.map((mapping) => mapping.confidence)];
  const overallConfidence = confidences.length ? Math.round(confidences.reduce((sum, value) => sum + value, 0) / confidences.length) : 0;
  const highConfidenceCount = facts.filter((fact) => fact.level === "HIGH").reduce((sum, fact) => sum + fact.plannedCount, 0);
  const needsConfirmationCount = facts.filter((fact) => fact.level !== "HIGH").length + mappingSuggestions.filter((mapping) => mapping.level !== "HIGH").length;
  const mappedHeaders = new Set(mappingSuggestions.map((mapping) => `${mapping.sourceField}:${mapping.targetField}`));
  const ignoredColumnCount = Math.max(0, sheets.reduce((sum, sheet) => sum + sheet.headers.length, 0) - mappedHeaders.size);
  return { scopeSuggestion, projectCandidate: projectCandidates[0] ?? null, projectCandidates, facts, overallConfidence, highConfidenceCount, needsConfirmationCount, ignoredColumnCount };
}
