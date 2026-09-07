import * as XLSX from "xlsx";
import { normalizeHeader } from "./data-migration-rules";

export const sheetClassifications = [
  "PROJECT_SUMMARY", "CONTRACT", "PROJECT_COST", "SKU_DETAIL", "SUPPLIER_QUOTE", "PURCHASE_ORDER",
  "PAYABLE", "PAYMENT", "RECEIVABLE", "RECEIPT", "INVOICE", "REFERENCE", "EMPTY", "UNKNOWN",
] as const;

export type SheetClassification = typeof sheetClassifications[number];
export type FingerprintStatus = "NEW" | "UPDATED" | "UNCHANGED" | "DUPLICATE" | "UNSUPPORTED" | "ERROR";

export type ParsedSheet = {
  index: number;
  name: string;
  headerRow: number;
  rows: Record<string, unknown>[];
  headers: string[];
  rowCount: number;
  columnCount: number;
  previewRows: Record<string, unknown>[];
  classification: SheetClassification;
  classificationConfidence: number;
  classificationWarnings: string[];
  isEmpty: boolean;
};

const supportedExtensions = new Set([".xlsx", ".xls", ".csv"]);
export function isSupportedImportFile(filename: string) {
  const extension = filename.slice(filename.lastIndexOf(".")).toLowerCase();
  return supportedExtensions.has(extension);
}

export function sourceGroupKey(filename: string) {
  return normalizeHeader(filename
    .replace(/\.(xlsx|xls|csv)$/i, "")
    .replace(/[（(]\d+[）)]$/u, "")
    .replace(/(?:19|20)\d{2}[-./年]\d{1,2}(?:[-./月]\d{1,2}日?)?/gu, "")
    .replace(/(?:更新|修订|终版|最终版|未完结|已完结|副本|copy|rev)[-_\s]?[a-z0-9.]*/giu, "")
    .replace(/v\d+(?:\.\d+)*/giu, ""));
}

function uniqueHeaders(values: unknown[]) {
  const seen = new Map<string, number>();
  return values.map((value, index) => {
    const base = String(value ?? "").trim() || `未命名列${index + 1}`;
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    return count === 1 ? base : `${base}_${count}`;
  });
}

const knownHeaderPattern = /(项目|合同|客户|供应商|产品|品名|名称|编号|编码|规格|数量|单位|单价|金额|成本|应收|应付|付款|收款|发票|税率)/u;
function detectHeaderRow(matrix: unknown[][]) {
  let best = { index: 0, score: -1 };
  matrix.slice(0, 30).forEach((row, index) => {
    const cells = row.map((value) => String(value ?? "").trim()).filter(Boolean);
    const known = cells.filter((value) => knownHeaderPattern.test(value)).length;
    const score = cells.length + known * 4 - (cells.length === 1 ? 3 : 0);
    if (score > best.score) best = { index, score };
  });
  return best.index;
}

function includesAny(value: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(value));
}

export function classifySheet(name: string, headers: string[], rowCount: number) {
  if (rowCount === 0 || headers.length === 0) return { classification: "EMPTY" as const, confidence: 10000, warnings: ["Sheet 没有可导入数据"] };
  const nameKey = normalizeHeader(name);
  if (/总成本|成本表|项目成本/u.test(nameKey)) return { classification: "PROJECT_COST" as const, confidence: 9600, warnings: [] as string[] };
  if (/项目汇总|项目总表|项目台账/u.test(nameKey)) return { classification: "PROJECT_SUMMARY" as const, confidence: 9500, warnings: [] as string[] };
  if (/钢化玻璃|采购订单|采购单/u.test(nameKey)) return { classification: "PURCHASE_ORDER" as const, confidence: 9300, warnings: [] as string[] };
  if (/新增雕塑|报价|询价/u.test(nameKey)) return { classification: "SUPPLIER_QUOTE" as const, confidence: 9000, warnings: [] as string[] };
  if (/饰品|sku|产品明细/u.test(nameKey)) return { classification: "SKU_DETAIL" as const, confidence: 8800, warnings: [] as string[] };
  const text = normalizeHeader(`${name} ${headers.join(" ")}`);
  const rules: { type: SheetClassification; patterns: RegExp[]; score: number }[] = [
    { type: "INVOICE", patterns: [/发票/u, /开票/u, /税号/u], score: 9300 },
    { type: "RECEIPT", patterns: [/收款/u, /到账/u, /回款/u], score: 9200 },
    { type: "PAYMENT", patterns: [/付款/u, /支付/u, /实付/u], score: 9200 },
    { type: "RECEIVABLE", patterns: [/应收/u, /收款计划/u], score: 9000 },
    { type: "PAYABLE", patterns: [/应付/u, /付款计划/u, /欠款/u], score: 9000 },
    { type: "PURCHASE_ORDER", patterns: [/采购订单/u, /采购单/u, /下单/u, /钢化玻璃/u], score: 8800 },
    { type: "SUPPLIER_QUOTE", patterns: [/报价/u, /核价/u, /询价/u, /新增雕塑/u], score: 8400 },
    { type: "PROJECT_COST", patterns: [/总成本/u, /成本表/u, /项目成本/u, /预算金额/u], score: 9000 },
    { type: "PROJECT_SUMMARY", patterns: [/项目汇总/u, /项目总表/u, /项目台账/u], score: 8200 },
    { type: "SKU_DETAIL", patterns: [/饰品/u, /sku/u, /产品明细/u, /品名.*数量.*单价/u], score: 8000 },
    { type: "CONTRACT", patterns: [/合同/u, /签约/u], score: 8300 },
    { type: "REFERENCE", patterns: [/字典/u, /基础资料/u, /供应商名录/u, /客户名录/u], score: 7800 },
  ];
  const matched = rules.find((rule) => includesAny(text, rule.patterns));
  return matched
    ? { classification: matched.type, confidence: matched.score, warnings: [] as string[] }
    : { classification: "UNKNOWN" as const, confidence: 0, warnings: ["未能可靠判断业务类型，需要人工选择"] };
}

export function parseWorkbook(bytes: Buffer, filename: string): ParsedSheet[] {
  if (!isSupportedImportFile(filename)) throw new Error("仅支持 .xlsx / .xls / .csv 文件");
  const book = XLSX.read(bytes, { type: "buffer", cellDates: false });
  if (!book.SheetNames.length) throw new Error("工作簿中没有 Sheet");
  return book.SheetNames.map((name, index) => {
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(book.Sheets[name], { header: 1, defval: "", raw: true, blankrows: false });
    const nonEmpty = matrix.filter((row) => row.some((value) => String(value ?? "").trim() !== ""));
    if (!nonEmpty.length) return { index, name, headerRow: 0, rows: [], headers: [], rowCount: 0, columnCount: 0, previewRows: [], classification: "EMPTY", classificationConfidence: 10000, classificationWarnings: ["Sheet 没有可导入数据"], isEmpty: true };
    const headerIndex = detectHeaderRow(matrix);
    const headers = uniqueHeaders(matrix[headerIndex] ?? []);
    const rows = matrix.slice(headerIndex + 1).flatMap((values, rowIndex) => {
      if (!values.some((value) => String(value ?? "").trim() !== "")) return [];
      return [{ __sourceRow: headerIndex + rowIndex + 2, ...Object.fromEntries(headers.map((header, column) => [header, values[column] ?? ""])) }];
    });
    if (rows.length > 10_000) throw new Error(`Sheet“${name}”超过 10,000 行，请拆分后迁移`);
    const classified = classifySheet(name, headers, rows.length);
    return { index, name, headerRow: headerIndex + 1, rows, headers, rowCount: rows.length, columnCount: headers.length, previewRows: rows.slice(0, 50), classification: classified.classification, classificationConfidence: classified.confidence, classificationWarnings: classified.warnings, isEmpty: rows.length === 0 };
  });
}

type FactEvidence = { sheetIndex: number; sourceRow: number; sourceColumn: string | null; sourceCell: string | null; role: "PRIMARY" | "SUPPORTING"; rawValue: string | null };
export type BusinessFactCandidate = { factType: string; businessKey: string; payload: Record<string, unknown>; evidence: FactEvidence[] };

const firstEntry = (row: Record<string, unknown>, patterns: RegExp[]) => Object.entries(row).find(([key, value]) => key !== "__sourceRow" && includesAny(normalizeHeader(key), patterns) && String(value ?? "").trim());
const firstValue = (row: Record<string, unknown>, patterns: RegExp[]) => firstEntry(row, patterns)?.[1];

export function buildBusinessFacts(sheets: ParsedSheet[]): BusinessFactCandidate[] {
  const facts = new Map<string, BusinessFactCandidate>();
  for (const sheet of sheets) {
    if (!["PROJECT_COST", "SKU_DETAIL", "SUPPLIER_QUOTE", "PURCHASE_ORDER"].includes(sheet.classification)) continue;
    for (const row of sheet.rows) {
      const code = firstValue(row, [/编码/u, /编号/u, /货号/u, /sku/u]);
      const name = firstValue(row, [/品名/u, /产品名称/u, /^名称$/u, /项目名称/u]);
      const specification = firstValue(row, [/规格/u, /型号/u]);
      const amountEntry = firstEntry(row, [/金额/u, /合计/u, /成本/u]); const amount = amountEntry?.[1];
      if (!code && !name) continue;
      const businessKey = normalizeHeader(`${code ?? ""}|${name ?? ""}|${specification ?? ""}`);
      const mapKey = `COST_ITEM:${businessKey}`;
      const role = sheet.classification === "PROJECT_COST" ? "SUPPORTING" : "PRIMARY";
      const columnIndex = amountEntry ? sheet.headers.indexOf(amountEntry[0]) : -1;
      const sourceColumn = amountEntry?.[0] ?? null;
      const sourceCell = columnIndex >= 0 ? `${XLSX.utils.encode_col(columnIndex)}${Number(row.__sourceRow)}` : null;
      const evidence: FactEvidence = { sheetIndex: sheet.index, sourceRow: Number(row.__sourceRow), sourceColumn, sourceCell, role, rawValue: amount === undefined ? null : String(amount) };
      const existing = facts.get(mapKey);
      if (existing) {
        existing.evidence.push(evidence);
        if (role === "PRIMARY") existing.payload = { code, name, specification, amount, sourceClassification: sheet.classification };
      } else {
        facts.set(mapKey, { factType: "COST_ITEM", businessKey, payload: { code, name, specification, amount, sourceClassification: sheet.classification }, evidence: [evidence] });
      }
    }
  }
  return [...facts.values()];
}
