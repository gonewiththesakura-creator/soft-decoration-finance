import { describe, expect, it } from "vitest";
import { can } from "@/lib/permissions";
import { normalizeRows } from "@/data/excel";
import { formatMoney } from "@/lib/format";
import type { SessionUser } from "@/lib/auth";
import { applyFieldMapping, parseAmount, parseBooleanValue, parseExcelDate, parseQuantity, parseRatio, suggestFieldMappings } from "@/data/data-migration-rules";
import { buildCashflowForecast, groupCashflowByWeek, projectedBalance } from "@/data/analytics/cashflow";
import { calculateProjectHealth } from "@/data/analytics/health";
import * as XLSX from "xlsx";
import { buildBusinessFacts, classifySheet, parseWorkbook, sourceGroupKey, type ParsedSheet } from "@/data/import-pilot";
import { analyzeWorkbook, confidenceLevel, detectProjectConflict, extractProjectCandidate, recognizeSheetFacts, suggestIntelligentMappings } from "@/data/import-intelligence";
import { duplicateRules } from "@/data/data-migration-rules";
import { extractWorkbookImages } from "@/data/excel-images";
import { strToU8, zipSync } from "fflate";
import { normalizeDisplayName } from "@/data/user-profile";

const finance: SessionUser = { id: 2, companyId: 1, name: "财务", email: "finance@test", role: "finance" };
const designer: SessionUser = { id: 3, companyId: 1, name: "设计", email: "designer@test", role: "designer" };
const owner: SessionUser = { id: 1, companyId: null, name: "老板", email: "owner@test", role: "owner" };
const procurement: SessionUser = { id: 4, companyId: 1, name: "采购", email: "procurement@test", role: "procurement" };
const manager: SessionUser = { id: 5, companyId: 1, name: "项目经理", email: "manager@test", role: "project_manager" };

describe("role permissions", () => {
  it("allows finance to record payments but blocks procurement editing", () => {
    expect(can(finance, "payments", "write")).toBe(true);
    expect(can(finance, "skus", "write")).toBe(false);
  });

  it("keeps designer away from financial and procurement writes", () => {
    expect(can(designer, "skus", "write")).toBe(false);
    expect(can(designer, "accounts")).toBe(false);
    expect(can(designer, "invoices")).toBe(false);
  });

  it("separates approval, procurement and financial confirmation duties", () => {
    expect(can(owner, "payments", "write")).toBe(false);
    expect(can(procurement, "skus", "write")).toBe(true);
    expect(can(manager, "payment-requests", "write")).toBe(true);
    expect(can(manager, "receipts", "write")).toBe(false);
  });
});

describe("user profile", () => {
  it("normalizes a display name and rejects empty or oversized values", () => {
    expect(normalizeDisplayName("  青岛  项目经理  ")).toBe("青岛 项目经理");
    expect(() => normalizeDisplayName("   ")).toThrow("1-30");
    expect(() => normalizeDisplayName("名".repeat(31))).toThrow("1-30");
  });
});

describe("Excel preflight", () => {
  it("rejects missing required columns without producing import rows", () => {
    const result = normalizeRows("customers", [{ 客户名称: "缺少公司与编码" }]);
    expect(result.errors.some((error) => error.message === "缺少必填列")).toBe(true);
  });

  it("accepts a valid customer row", () => {
    const result = normalizeRows("customers", [{ "公司名称 / 编码": "SH01", 客户编码: "T-001", 客户名称: "测试客户", 客户类型: "地产公司", 联系人: "陈经理", 联系电话: "13800000000" }]);
    expect(result.errors).toHaveLength(0);
    expect(result.rows[0].code).toBe("T-001");
  });
});

describe("data migration deterministic rules", () => {
  it("maps legacy aliases without AI", () => {
    const mappings = suggestFieldMappings("projects", ["所属公司", "甲方", "工程名称", "项目编号", "合同金额", "采购预算", "开工日期", "预计完工日期"]);
    expect(mappings["所属公司"]).toBe("companyId");
    expect(mappings["甲方"]).toBe("customerId");
    expect(suggestFieldMappings("projects", ["工程编号"])["工程编号"]).toBe("code");
    expect(mappings["工程名称"]).toBe("name");
    expect(suggestFieldMappings("purchase-requests", ["已核价金额"])["已核价金额"]).toBe("amountYuan");
    expect(suggestFieldMappings("receipts", ["已收款"])["已收款"]).toBe("amountYuan");
  });

  it("normalizes money, dates, ratios, booleans and decimal quantities", () => {
    expect(parseAmount("￥1.2万")).toBe(12000);
    expect(parseAmount("12,000元")).toBe(12000);
    expect(parseExcelDate(45536)).toBe("2024-09-01");
    expect(parseExcelDate("2026.09.01")).toBe("2026-09-01");
    expect(parseRatio("13%")).toBe(13);
    expect(parseRatio(0.13)).toBe(13);
    expect(parseBooleanValue("是")).toBe(true);
    expect(parseQuantity("12.5000")).toBe(12.5);
  });

  it("applies field mappings and preserves four-decimal quantities", () => {
    const row = applyFieldMapping("skus", { 工程名称: "PRJ-001", 产品编码: "SKU-001", 区域: "大堂", 分类: "家具", 名称: "沙发", 数量: "12.5000", 单位: "件", 预算价: "￥1,200" }, { 工程名称: "projectId", 产品编码: "code", 区域: "room", 分类: "category", 名称: "name", 数量: "quantity", 单位: "unit", 预算价: "budgetUnitYuan" });
    expect(row.quantity).toBe(12.5);
    expect(row.budgetUnitYuan).toBe(1200);
  });
});

describe("V1.7 real-data workbook rules", () => {
  it("normalizes dated workbook versions into one source group", () => {
    expect(sourceGroupKey("1.青岛鑫江中心成本表（2023-5-13更新）未完结(1).xlsx")).toBe(sourceGroupKey("1.青岛鑫江中心成本表（2023-6-01更新）终版.xlsx"));
  });

  it("classifies the Qingdao pilot sheet family and keeps empty sheets", () => {
    expect(classifySheet("总成本", ["品名", "数量", "成本金额"], 3).classification).toBe("PROJECT_COST");
    expect(classifySheet("饰品", ["产品名称", "规格", "数量", "单价"], 3).classification).toBe("SKU_DETAIL");
    expect(classifySheet("新增雕塑", ["供应商", "品名", "报价"], 3).classification).toBe("SUPPLIER_QUOTE");
    expect(classifySheet("钢化玻璃", ["采购单号", "数量", "金额"], 3).classification).toBe("PURCHASE_ORDER");
    expect(classifySheet("雕塑", [], 0).classification).toBe("EMPTY");
    expect(classifySheet("备注", ["说明"], 1).classification).toBe("UNKNOWN");
  });

  it("detects a title row and preserves up to 50 preview rows", () => {
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["青岛鑫江中心成本表"], ["产品编码", "品名", "数量", "成本金额"], ...Array.from({ length: 55 }, (_, index) => [`QD-${index + 1}`, `饰品${index + 1}`, 1, 100 + index])]), "总成本");
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([]), "雕塑");
    const parsed = parseWorkbook(Buffer.from(XLSX.write(book, { type: "buffer", bookType: "xlsx" })), "青岛成本表.xlsx");
    expect(parsed[0]).toMatchObject({ headerRow: 2, rowCount: 55, classification: "PROJECT_COST" });
    expect(parsed[0].previewRows).toHaveLength(50);
    expect(parsed[1].classification).toBe("EMPTY");
  });

  it("models summary and detail duplicates as one fact with multiple evidence", () => {
    const base: Omit<ParsedSheet, "index" | "name" | "classification" | "rows"> = { headerRow: 1, headers: ["产品编码", "品名", "规格", "金额"], rowCount: 1, columnCount: 4, previewRows: [], classificationConfidence: 9000, classificationWarnings: [], isEmpty: false };
    const facts = buildBusinessFacts([
      { ...base, index: 0, name: "总成本", classification: "PROJECT_COST", rows: [{ __sourceRow: 2, 产品编码: "QD-01", 品名: "陶瓷摆件", 规格: "大", 金额: 1000 }] },
      { ...base, index: 1, name: "饰品", classification: "SKU_DETAIL", rows: [{ __sourceRow: 8, 产品编码: "QD-01", 品名: "陶瓷摆件", 规格: "大", 金额: 1000 }] },
    ]);
    expect(facts).toHaveLength(1);
    expect(facts[0].evidence).toHaveLength(2);
    expect(facts[0].evidence.map((item) => item.role).sort()).toEqual(["PRIMARY", "SUPPORTING"]);
  });
});

describe("V1.7.2 project-scoped intelligent import", () => {
  const projectSheet: ParsedSheet = {
    index: 0,
    name: "钢化玻璃采购",
    headerRow: 1,
    headers: ["供应商", "产品名称", "规格", "数量", "单价", "货款", "增值税", "合计", "付款条件"],
    rows: [{ __sourceRow: 2, 供应商: "凯特斯雕塑", 产品名称: "玻璃台面", 规格: "1200x600", 数量: 2, 单价: 1800, 货款: 3600, 增值税: 468, 合计: 4068, 付款条件: "30%预付" }],
    rowCount: 1,
    columnCount: 9,
    previewRows: [],
    classification: "PURCHASE_ORDER",
    classificationConfidence: 9100,
    classificationWarnings: [],
    isEmpty: false,
  };

  it("extracts and consolidates a project candidate from the filename and workbook title", () => {
    expect(extractProjectCandidate("1.青岛鑫江中心成本表（2023-5-13更新）未完结.xlsx")).toBe("青岛鑫江中心");
    const analysis = analyzeWorkbook("青岛鑫江中心采购.xlsx", [{ ...projectSheet, titleValues: ["青岛鑫江中心项目"] }]);
    expect(analysis.scopeSuggestion).toBe("PROJECT");
    expect(analysis.projectCandidate).toMatchObject({ name: "青岛鑫江中心项目", level: "HIGH" });
    expect(analysis.projectCandidate?.sources).toEqual(expect.arrayContaining(["文件名", "Sheet“钢化玻璃采购”内容"]));
  });

  it("rejects contact details and document metadata as project candidates", () => {
    expect(extractProjectCandidate("电话/传真:18676166588 Email:test@example.com")).toBeNull();
    expect(extractProjectCandidate("网址：www.example.com 地址：工业区")).toBeNull();
    expect(extractProjectCandidate("订单编号：GLTD0510A")).toBeNull();
    expect(extractProjectCandidate("1.青岛鑫江中心成本表_2023-5-13更新_未完结_1_.xlsx")).toBe("青岛鑫江中心");
  });

  it("trims styled blank columns and infers headers for legacy SKU sheets", () => {
    const book = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([[21, "大堂", "", "艺术品摆件", "常规尺寸", 2, "组", "陶瓷", "", "", "", 120, 240, "https://example.com"]]);
    sheet["!ref"] = "A1:XFC1";
    XLSX.utils.book_append_sheet(book, sheet, "饰品");
    const parsed = parseWorkbook(Buffer.from(XLSX.write(book, { type: "buffer", bookType: "xlsx" })), "青岛项目饰品.xlsx")[0];
    expect(parsed).toMatchObject({ headerRow: 0, columnCount: 14, rowCount: 1, classification: "SKU_DETAIL" });
    expect(parsed.headers.slice(0, 7)).toEqual(["序号", "房间区域", "图片", "产品名称", "规格", "数量", "单位"]);
  });

  it("associates OOXML drawing media with its worksheet row and column", () => {
    const xml = (value: string) => strToU8(value);
    const bytes = Buffer.from(zipSync({
      "xl/workbook.xml": xml(`<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="产品" r:id="rId1"/></sheets></workbook>`),
      "xl/_rels/workbook.xml.rels": xml(`<Relationships><Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/></Relationships>`),
      "xl/worksheets/sheet1.xml": xml(`<worksheet/>`),
      "xl/worksheets/_rels/sheet1.xml.rels": xml(`<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>`),
      "xl/drawings/drawing1.xml": xml(`<xdr:wsDr><xdr:oneCellAnchor><xdr:from><xdr:col>1</xdr:col><xdr:row>2</xdr:row></xdr:from><xdr:pic><xdr:blipFill><a:blip r:embed="rId8"/></xdr:blipFill></xdr:pic></xdr:oneCellAnchor></xdr:wsDr>`),
      "xl/drawings/_rels/drawing1.xml.rels": xml(`<Relationships><Relationship Id="rId8" Type="image" Target="../media/image1.png"/></Relationships>`),
      "xl/media/image1.png": Uint8Array.from([137, 80, 78, 71]),
    }));
    expect(extractWorkbookImages(bytes, "products.xlsx")[0]).toMatchObject({ sheetName: "产品", sheetIndex: 0, sourceRow: 3, sourceColumn: 2, mimeType: "image/png" });
  });

  it("recognizes multiple business facts from one sheet", () => {
    const factTypes = recognizeSheetFacts(projectSheet).map((fact) => fact.factType);
    expect(factTypes).toEqual(expect.arrayContaining(["SKU", "SUPPLIER", "PURCHASE_ORDER_LINE", "PAYABLE", "TAX", "PAYMENT_TERMS"]));
  });

  it("auto-accepts exact mappings and flags fuzzy mappings for confirmation", () => {
    const exact = suggestIntelligentMappings("contracts", ["合同金额"])[0];
    const fuzzy = suggestIntelligentMappings("contracts", ["合同金额原值"])[0];
    expect(exact).toMatchObject({ targetField: "amountYuan", confidence: 9800, level: "HIGH" });
    expect(fuzzy).toMatchObject({ targetField: "amountYuan", confidence: 7600, level: "MEDIUM" });
    expect(confidenceLevel(6900)).toBe("LOW");
  });

  it("never lets a later total-price column overwrite an already mapped unit price", () => {
    const mappings = suggestFieldMappings("skus", ["单价", "价格", "数量"]);
    expect(mappings).toMatchObject({ 单价: "budgetUnitYuan", 价格: "", 数量: "quantity" });
  });

  it("blocks a strong conflicting project candidate", () => {
    expect(detectProjectConflict("青岛鑫江中心", { name: "杭州万豪酒店", confidence: 9300, level: "HIGH", sources: ["文件名"] })).toMatchObject({ level: "CONFLICT" });
    expect(detectProjectConflict("青岛鑫江中心项目", { name: "青岛鑫江中心", confidence: 9700, level: "HIGH", sources: ["内容"] })).toBeNull();
  });

  it("keeps supplier deduplication company-scoped while SKU keys remain project-scoped", () => {
    expect(duplicateRules.suppliers).toMatchObject({ companyScoped: true });
    expect(duplicateRules.suppliers).not.toHaveProperty("scopeField");
    expect(duplicateRules.skus).toMatchObject({ scopeField: "projectId", scopeColumn: "project_id" });
  });
});

it("formats integer cents without floating point leakage", () => {
  expect(formatMoney(123456)).toBe("¥1,234.56");
});

describe("operating analytics", () => {
  it("builds a deterministic cumulative cash forecast", () => {
    const forecast = buildCashflowForecast(1_000_000, [
      { date: "2026-09-03", receivableCents: 300_000, payableCents: 100_000 },
      { date: "2026-09-04", receivableCents: 0, payableCents: 1_500_000 },
    ]);
    expect(forecast.map((row) => row.balanceCents)).toEqual([1_200_000, -300_000]);
    expect(projectedBalance(forecast, 7, 1_000_000)).toBe(-300_000);
    expect(groupCashflowByWeek(forecast)[0]).toMatchObject({ receivableCents: 300_000, payableCents: 1_600_000 });
  });

  it("scores budget, collection, overdue, invoice and funding risks", () => {
    const healthy = calculateProjectHealth({ contractCents: 10_000_000, budgetCents: 5_000_000, receivedCents: 8_000_000, orderedCents: 4_800_000, payableCents: 4_000_000, paidCents: 3_000_000, purchaseInvoicedCents: 4_000_000, overdueReceivableCents: 0 });
    const risky = calculateProjectHealth({ contractCents: 10_000_000, budgetCents: 5_000_000, receivedCents: 1_000_000, orderedCents: 7_500_000, payableCents: 7_000_000, paidCents: 4_000_000, purchaseInvoicedCents: 1_000_000, overdueReceivableCents: 3_000_000 });
    expect(healthy).toMatchObject({ score: 100, tone: "healthy" });
    expect(risky.score).toBeLessThan(60);
    expect(risky.reasons).toEqual(expect.arrayContaining(["回款率偏低", "采购已超预算", "存在逾期应收", "进项发票覆盖不足", "项目现金净额为负"]));
  });
});
