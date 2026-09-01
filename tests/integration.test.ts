import { describe, expect, it } from "vitest";
import { sqlQuery } from "@/db/client";
import { decidePayment, decidePurchase, executePayment, getPaymentApprovalDetail, getPurchaseApprovalDetail } from "@/data/workflows";
import { createResource, updateResource, voidResource } from "@/data/mutations";
import { getResourceData } from "@/data/resources";
import { importRowsAtomic, preflightImport } from "@/data/excel-import";
import { authenticate } from "@/lib/auth";
import type { SessionUser } from "@/lib/auth";

const owner: SessionUser = { id: 1, companyId: null, name: "陈屿", email: "owner@zhiheng.local", role: "owner" };

async function financeFor(companyId: number) {
  const [finance] = await sqlQuery<{ id: number; companyId: number; name: string; email: string }>(`SELECT id,company_id AS "companyId",name,email FROM users WHERE role='finance' AND company_id=$1 LIMIT 1`, [companyId]);
  return { ...finance, role: "finance" as const };
}

describe.sequential("business workflow integration", () => {
  it("enforces project membership and company scope for a project manager", async () => {
    const [manager] = await sqlQuery<{ id: number; companyId: number; name: string; email: string }>(`SELECT id,company_id AS "companyId",name,email FROM users WHERE role='project_manager' AND company_id=1 LIMIT 1`);
    const user: SessionUser = { ...manager, role: "project_manager" };
    const data = await getResourceData("projects", user, manager.companyId);
    expect(data?.rows).toHaveLength(4);
    expect(data?.rows.every((row) => row.companyId === 1)).toBe(true);
  });

  it("approves a purchase and atomically creates order, payable and audit log", async () => {
    const [request] = await sqlQuery<{ id: number; number: string }>("SELECT id,number FROM purchase_requests WHERE status='待审批' ORDER BY id LIMIT 1");
    await expect(decidePurchase(request.id, "approve", "", owner)).rejects.toThrow("请填写审批意见");
    const [before] = await sqlQuery<{ orders: number; payables: number }>("SELECT (SELECT count(*)::int FROM purchase_orders) AS orders,(SELECT count(*)::int FROM payables) AS payables");
    const result = await decidePurchase(request.id, "approve", "集成测试通过", owner);
    const [after] = await sqlQuery<{ status: string; orders: number; payables: number; logs: number }>(`SELECT (SELECT status FROM purchase_requests WHERE id=$1) AS status,(SELECT count(*)::int FROM purchase_orders) AS orders,(SELECT count(*)::int FROM payables) AS payables,(SELECT count(*)::int FROM audit_logs WHERE object_type='purchase_request' AND object_id=$1 AND action='APPROVE') AS logs`, [request.id]);
    expect(result.orderId).toBeTypeOf("number");
    expect(after.status).toBe("已通过");
    expect(after.orders).toBe(before.orders + 1);
    expect(after.payables).toBe(before.payables + 1);
    expect(after.logs).toBeGreaterThan(0);
  });

  it("records a receipt and updates both receivable and account balance", async () => {
    const [plan] = await sqlQuery<{ id: number; companyId: number; projectId: number; remaining: number; receivedCents: number }>(`SELECT id,company_id AS "companyId",project_id AS "projectId",received_cents AS "receivedCents",(amount_cents-received_cents)::float8 AS remaining FROM receivable_plans WHERE NOT is_void AND NOT is_warranty AND received_cents<amount_cents ORDER BY id LIMIT 1`);
    const [account] = await sqlQuery<{ id: number; balance: number }>(`SELECT id,balance_cents AS balance FROM company_accounts WHERE company_id=$1 ORDER BY id LIMIT 1`, [plan.companyId]);
    const amount = Math.min(10_000, plan.remaining);
    const finance = await financeFor(plan.companyId);
    await createResource("receipts", { receivablePlanId: plan.id, accountId: account.id, number: `TEST-SK-${Date.now()}`, amountYuan: amount / 100, receivedAt: "2026-08-31" }, finance);
    const [after] = await sqlQuery<{ receivedCents: number; accountBalance: number; logs: number }>(`SELECT (SELECT received_cents FROM receivable_plans WHERE id=$1) AS "receivedCents",(SELECT balance_cents FROM company_accounts WHERE id=$2) AS "accountBalance",(SELECT count(*)::int FROM audit_logs WHERE object_type='receipts' AND action='CREATE') AS logs`, [plan.id, account.id]);
    expect(after.receivedCents).toBe(plan.receivedCents + amount);
    expect(after.accountBalance).toBe(account.balance + amount);
    expect(after.logs).toBeGreaterThan(0);
  });

  it("approves and executes a payment with payable and account balance updates", async () => {
    const [request] = await sqlQuery<{ id: number; companyId: number; payableId: number; accountId: number; amountCents: number }>(`SELECT id,company_id AS "companyId",payable_id AS "payableId",account_id AS "accountId",amount_cents AS "amountCents" FROM payment_requests WHERE status='待审批' ORDER BY id LIMIT 1`);
    const [before] = await sqlQuery<{ paidCents: number; balanceCents: number }>(`SELECT y.paid_cents AS "paidCents",a.balance_cents AS "balanceCents" FROM payables y JOIN company_accounts a ON a.id=$2 WHERE y.id=$1`, [request.payableId, request.accountId]);
    await decidePayment(request.id, "approve", "集成测试通过", owner);
    await expect(executePayment(request.id, owner, "https://example.test/receipt.pdf")).rejects.toThrow("仅财务可以执行付款");
    const finance = await financeFor(request.companyId); const payment = await executePayment(request.id, finance, "https://example.test/receipt.pdf");
    const [after] = await sqlQuery<{ status: string; paidCents: number; balanceCents: number }>(`SELECT r.status,y.paid_cents AS "paidCents",a.balance_cents AS "balanceCents" FROM payment_requests r JOIN payables y ON y.id=r.payable_id JOIN company_accounts a ON a.id=r.account_id WHERE r.id=$1`, [request.id]);
    expect(payment.number).toMatch(/^FK-/);
    expect(after.status).toBe("已付款");
    expect(after.paidCents).toBe(before.paidCents + request.amountCents);
    expect(after.balanceCents).toBe(before.balanceCents - request.amountCents);
    await voidResource("payments", payment.id, "验收测试冲销", finance);
    const [reversed] = await sqlQuery<{ paidCents: number; balanceCents: number; status: string }>(`SELECT y.paid_cents AS "paidCents",a.balance_cents AS "balanceCents",f.status FROM payments f JOIN payables y ON y.id=f.payable_id JOIN company_accounts a ON a.id=f.account_id WHERE f.id=$1`, [payment.id]);
    expect(reversed.paidCents).toBe(before.paidCents); expect(reversed.balanceCents).toBe(before.balanceCents); expect(reversed.status).toBe("已冲销");
  });

  it("migrates all financial amounts and physical quantities to numeric", async () => {
    const columns = await sqlQuery<{ tableName: string; columnName: string; dataType: string; precision: number; scale: number }>(`SELECT table_name AS "tableName",column_name AS "columnName",data_type AS "dataType",numeric_precision::int AS precision,numeric_scale::int AS scale FROM information_schema.columns WHERE (column_name LIKE '%_cents' OR column_name IN ('quantity','remaining_quantity')) AND table_schema='public'`);
    expect(columns.filter((column) => column.columnName.endsWith("_cents")).every((column) => column.dataType === "numeric" && column.precision === 18 && column.scale === 0)).toBe(true);
    expect(columns.filter((column) => ["quantity", "remaining_quantity"].includes(column.columnName)).every((column) => column.dataType === "numeric" && column.scale === 4)).toBe(true);
  });

  it("edits only safe business states and writes before/after audit", async () => {
    const [request] = await sqlQuery<{ id: number; companyId: number; projectId: number; supplierId: number; skuId: number; number: string; amountCents: number }>(`SELECT r.id,r.company_id AS "companyId",r.project_id AS "projectId",r.supplier_id AS "supplierId",i.sku_id AS "skuId",r.number,r.amount_cents AS "amountCents" FROM purchase_requests r JOIN purchase_request_items i ON i.request_id=r.id WHERE r.status='待审批' ORDER BY r.id LIMIT 1`);
    const [procurement] = await sqlQuery<{ id: number; companyId: number; name: string; email: string }>(`SELECT id,company_id AS "companyId",name,email FROM users WHERE role='procurement' AND company_id=$1 LIMIT 1`, [request.companyId]);
    await updateResource("purchase-requests", request.id, { projectId: request.projectId, supplierId: request.supplierId, skuId: request.skuId, number: request.number, paymentType: "对公", amountYuan: request.amountCents / 100, reason: "验收整改后的安全编辑" }, { ...procurement, role: "procurement" });
    const [log] = await sqlQuery<{ before: unknown; after: unknown }>(`SELECT before,after FROM audit_logs WHERE object_type='purchase-requests' AND object_id=$1 AND action='UPDATE' ORDER BY id DESC LIMIT 1`, [request.id]);
    expect(log.before).toBeTruthy(); expect(log.after).toBeTruthy();
  });

  it("rejects an invalid import before writes and rolls back an unexpected batch conflict", async () => {
    const finance = await financeFor(1); const duplicateCode = `IMP-${Date.now()}`;
    const rows = [{ companyId: 1, code: duplicateCode, name: "导入客户甲", type: "商业客户", contact: "", phone: "" }, { companyId: 1, code: duplicateCode, name: "导入客户乙", type: "商业客户", contact: "", phone: "" }];
    const checked = await preflightImport("customers", rows, finance);
    expect(checked.errors.some((error) => error.message.includes("文件内存在重复"))).toBe(true);
    await expect(importRowsAtomic("customers", rows, "rollback.xlsx", checked.sourceHash, 1, finance)).rejects.toThrow();
    const [count] = await sqlQuery<{ count: number }>("SELECT count(*)::int AS count FROM customers WHERE code=$1", [duplicateCode]);
    expect(count.count).toBe(0);
  });

  it("rate limits repeated failed logins and records every attempt", async () => {
    const email = `missing-${Date.now()}@example.test`; const ip = `127.0.0.${Math.floor(Math.random() * 200) + 20}`;
    for (let index = 0; index < 5; index++) expect(await authenticate(email, "wrong", ip)).toBeNull();
    await expect(authenticate(email, "wrong", ip)).rejects.toThrow("RATE_LIMITED");
    const [attempts] = await sqlQuery<{ count: number }>("SELECT count(*)::int AS count FROM login_attempts WHERE email=$1 AND ip=$2", [email, ip]);
    expect(attempts.count).toBe(5);
  });

  it("returns complete approval details before owner decisions", async () => {
    const [purchase] = await sqlQuery<{ id: number }>("SELECT id FROM purchase_requests WHERE status='待审批' AND NOT is_void ORDER BY id LIMIT 1");
    const purchaseDetail = await getPurchaseApprovalDetail(purchase.id, owner);
    expect(purchaseDetail.header.companyName).toBeTruthy(); expect(purchaseDetail.items.length).toBeGreaterThan(0); expect(purchaseDetail.quotes.length).toBeGreaterThan(0);
    const [payment] = await sqlQuery<{ id: number }>("SELECT id FROM payment_requests WHERE status='待审批' AND NOT is_void ORDER BY id LIMIT 1");
    const paymentDetail = await getPaymentApprovalDetail(payment.id, owner);
    expect(paymentDetail.header.orderNumber).toBeTruthy(); expect(Number(paymentDetail.header.accountBalanceAfterCents)).toBeTypeOf("number");
  });

  it("keeps approved payment requests within the current payable balance", async () => {
    const [invalid] = await sqlQuery<{ count: number }>(`SELECT count(*)::int AS count FROM payment_requests r JOIN payables y ON y.id=r.payable_id WHERE r.status='已通过' AND NOT r.is_void AND r.amount_cents>y.amount_cents-y.paid_cents`);
    expect(invalid.count).toBe(0);
  });

  it("links exchanges to inventory and invoices to a concrete payable", async () => {
    const [batch] = await sqlQuery<{ orderId: number; companyId: number; remaining: number }>(`SELECT purchase_order_id AS "orderId",company_id AS "companyId",remaining_quantity AS remaining FROM inventory_batches WHERE remaining_quantity>=1 AND purchase_order_id NOT IN (SELECT purchase_order_id FROM purchase_returns WHERE type='换货') ORDER BY id LIMIT 1`);
    const [procurement] = await sqlQuery<{ id: number; companyId: number; name: string; email: string }>(`SELECT id,company_id AS "companyId",name,email FROM users WHERE role='procurement' AND company_id=$1 LIMIT 1`, [batch.companyId]);
    await createResource("returns", { purchaseOrderId: batch.orderId, number: `HH-${Date.now()}`, type: "换货", quantity: 0.5, amountYuan: 0, reason: "验收测试换货" }, { ...procurement, role: "procurement" });
    const [inventory] = await sqlQuery<{ remaining: number; transactions: number }>(`SELECT remaining_quantity AS remaining,(SELECT count(*)::int FROM inventory_transactions WHERE batch_id=inventory_batches.id AND type='换货出库') AS transactions FROM inventory_batches WHERE purchase_order_id=$1`, [batch.orderId]);
    expect(inventory.remaining).toBe(batch.remaining - 0.5); expect(inventory.transactions).toBeGreaterThan(0);

    const [payable] = await sqlQuery<{ id: number; companyId: number; remainingInvoice: number }>(`SELECT y.id,y.company_id AS "companyId",(y.amount_cents-COALESCE((SELECT sum(amount_cents) FROM invoice_allocations WHERE payable_id=y.id),0))::float8 AS "remainingInvoice" FROM payables y WHERE NOT y.is_void AND y.amount_cents>COALESCE((SELECT sum(amount_cents) FROM invoice_allocations WHERE payable_id=y.id),0) ORDER BY y.id LIMIT 1`);
    const finance = await financeFor(payable.companyId); const invoice = await createResource("invoices", { direction: "进项", payableId: payable.id, number: `FP-TEST-${Date.now()}`, type: "专票", amountYuan: 1, issuedAt: "2026-09-01" }, finance);
    const [allocation] = await sqlQuery<{ amount: number }>("SELECT amount_cents AS amount FROM invoice_allocations WHERE invoice_id=$1", [invoice.id]);
    expect(allocation.amount).toBe(100);
  });
});
