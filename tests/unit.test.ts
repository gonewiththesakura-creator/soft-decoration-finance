import { describe, expect, it } from "vitest";
import { can } from "@/lib/permissions";
import { normalizeRows } from "@/data/excel";
import { formatMoney } from "@/lib/format";
import type { SessionUser } from "@/lib/auth";

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
    const result = normalizeRows("customers", [{ 公司ID: "1", 客户编码: "T-001", 客户名称: "测试客户", 客户类型: "地产公司", 联系人: "陈经理", 联系电话: "13800000000" }]);
    expect(result.errors).toHaveLength(0);
    expect(result.rows[0].code).toBe("T-001");
  });
});

it("formats integer cents without floating point leakage", () => {
  expect(formatMoney(123456)).toBe("¥1,234.56");
});
