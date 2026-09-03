import { describe, expect, it } from "vitest";
import { can } from "@/lib/permissions";
import { normalizeRows } from "@/data/excel";
import { formatMoney } from "@/lib/format";
import type { SessionUser } from "@/lib/auth";
import { applyFieldMapping, parseAmount, parseBooleanValue, parseExcelDate, parseQuantity, parseRatio, suggestFieldMappings } from "@/data/data-migration-rules";
import { buildCashflowForecast, groupCashflowByWeek, projectedBalance } from "@/data/analytics/cashflow";
import { calculateProjectHealth } from "@/data/analytics/health";

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
