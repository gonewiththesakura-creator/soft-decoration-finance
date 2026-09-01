import { describe, expect, it } from "vitest";
import { sqlQuery } from "@/db/client";
import { decidePayment, decidePurchase, executePayment, getPaymentApprovalDetail, getPurchaseApprovalDetail } from "@/data/workflows";
import { createResource, updateResource, voidResource } from "@/data/mutations";
import { getResourceData } from "@/data/resources";
import { importRowsAtomic, preflightImport } from "@/data/excel-import";
import { createAttachment, getAttachmentContent, getAttachments, voidAttachment } from "@/data/attachments";
import { getDocumentDetail } from "@/data/document-detail";
import { getFinanceWorkspace } from "@/data/finance-workspace";
import { getCustomerProfile, getSupplierProfile } from "@/data/partners";
import * as XLSX from "xlsx";
import { confirmMigrationBatch, createMigrationWorkbook, getMigrationBatch, importMigrationBatch, rollbackMigrationBatch, stageMigrationBatch, suggestedMappings, updateStagingRow } from "@/data/data-migration";
import { createWorkspacePurchaseRequest, getProcurementWorkspace } from "@/data/procurement-workspace";
import { getProjectDetail } from "@/data/project-detail";
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

  it("builds the project ledger from live contract, procurement and finance facts", async () => {
    const [project] = await sqlQuery<{ id: number }>("SELECT id FROM projects ORDER BY id LIMIT 1");
    const detail = await getProjectDetail(project.id, owner);
    expect(detail).not.toBeNull();
    expect(detail!.metrics.receivedCents).toBeGreaterThanOrEqual(0);
    expect(detail!.metrics.orderedCents).toBeGreaterThan(0);
    expect(detail!.timeline.length).toBeGreaterThan(0);
    expect(detail!.risks.length).toBeLessThanOrEqual(8);
  });

  it("creates a purchase request from a selected SKU in the procurement workspace", async () => {
    const [procurement] = await sqlQuery<{ id: number; companyId: number; name: string; email: string }>(`SELECT id,company_id AS "companyId",name,email FROM users WHERE role='procurement' ORDER BY company_id,id LIMIT 1`);
    const user: SessionUser = { ...procurement, role: "procurement" }; const workspace = await getProcurementWorkspace(user, procurement.companyId);
    const row = workspace.rows.find((item) => item.status === "已核价"); expect(row).toBeTruthy();
    const request = await createWorkspacePurchaseRequest({ skuIds: [Number(row!.id)], paymentType: "对公", reason: "V1.1 工作台集成测试" }, user);
    const [saved] = await sqlQuery<{ itemCount: number; status: string; logs: number }>(`SELECT (SELECT count(*)::int FROM purchase_request_items WHERE request_id=r.id) AS "itemCount",r.status,(SELECT count(*)::int FROM audit_logs WHERE object_type='purchase_request' AND object_id=r.id AND action='SUBMIT') AS logs FROM purchase_requests r WHERE r.id=$1`, [request.id]);
    expect(saved.itemCount).toBe(1); expect(saved.status).toBe("待审批"); expect(saved.logs).toBe(1);
  });

  it("loads company-scoped finance workbench totals without SQL parameter drift", async () => {
    const finance = await financeFor(1); const data = await getFinanceWorkspace(finance, finance.companyId);
    expect(Number(data.summary.balance)).toBeGreaterThan(0);
    expect(data.accounts.every((account) => Number(account.balanceCents) >= 0)).toBe(true);
    expect(Array.isArray(data.receivables)).toBe(true);
  });

  it("aggregates customer and supplier profiles from their source documents", async () => {
    const [customer] = await sqlQuery<{ id: number }>("SELECT customer_id AS id FROM projects ORDER BY id LIMIT 1");
    const [supplier] = await sqlQuery<{ id: number }>("SELECT supplier_id AS id FROM purchase_orders ORDER BY id LIMIT 1");
    const customerProfile = await getCustomerProfile(customer.id, owner); const supplierProfile = await getSupplierProfile(supplier.id, owner);
    expect(customerProfile).not.toBeNull(); expect(customerProfile!.metrics.projectCount).toBeGreaterThan(0);
    expect(supplierProfile).not.toBeNull(); expect(supplierProfile!.metrics.orderedCents).toBeGreaterThan(0);
    expect(supplierProfile!.metrics.remainingCents).toBe(supplierProfile!.metrics.payableCents - supplierProfile!.metrics.paidCents);
  });

  it("returns linked business document details and a real timeline", async () => {
    const [order] = await sqlQuery<{ id: number }>("SELECT id FROM purchase_orders WHERE NOT is_void ORDER BY id LIMIT 1");
    const detail = await getDocumentDetail("purchase-order", order.id, owner);
    expect(detail).not.toBeNull(); expect(detail!.relations.some((item) => item.label === "项目")).toBe(true);
    expect(detail!.relations.some((item) => item.label === "采购申请")).toBe(true); expect(detail!.events.length).toBeGreaterThan(0);
  });

  it("migrates a legacy workbook through mapping, staging, lineage and safe rollback", async () => {
    const finance = await financeFor(1); const [company] = await sqlQuery<{ name: string }>(`SELECT name FROM companies WHERE id=1`); const customerCode = `MIG-${Date.now()}`;
    const makeFile = (contact: string) => {
      const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["历史数据迁移测试"]]), "说明");
      XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet([{ 所属公司: company.name.replace("软装", "软装工程"), 客户编码: customerCode, 甲方: "迁移测试客户有限公司", 客户类型: "商业客户", 联系人: contact, 联系电话: "13800000000" }]), "客户历史");
      const bytes = XLSX.write(book, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
      return new File([bytes], `客户历史-${contact}.xlsx`, { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    };
    const workbook = await createMigrationWorkbook(makeFile("陈经理"), finance); expect(workbook.sheets).toHaveLength(2); expect(workbook.sheets[1].rowCount).toBe(1);
    const mappings = suggestedMappings("customers", workbook.sheets[1].headers); expect(mappings["所属公司"]).toBe("companyId"); expect(mappings["甲方"]).toBe("name");
    const staged = await stageMigrationBatch({ batchId: workbook.batchId, sheetId: workbook.sheets[1].id, businessType: "customers", mappings, saveTemplateName: "客户历史表测试格式" }, finance);
    expect(staged).toMatchObject({ ready: 0, warning: 1, error: 0, total: 1 });
    await expect(confirmMigrationBatch(workbook.batchId, finance)).rejects.toThrow("关联候选未逐项确认");
    const pending = await getMigrationBatch(workbook.batchId, finance); expect(pending.unresolvedReferences).toBe(1);
    await updateStagingRow(workbook.batchId, Number(pending.rows[0].id), { fieldKey: "companyId", confirmedReferenceId: 1 }, finance);
    const resolved = await getMigrationBatch(workbook.batchId, finance); expect(resolved.unresolvedReferences).toBe(0); expect(resolved.rows[0].status).toBe("READY");
    await confirmMigrationBatch(workbook.batchId, finance); const imported = await importMigrationBatch(workbook.batchId, finance); expect(imported.successRows).toBe(1);
    const [saved] = await sqlQuery<{ id: number; lineage: number; batchStatus: string }>(`SELECT c.id,(SELECT count(*)::int FROM import_data_lineage l WHERE l.target_table='customers' AND l.target_id=c.id) AS lineage,(SELECT status FROM import_batches WHERE id=$2) AS "batchStatus" FROM customers c WHERE c.code=$1`, [customerCode, workbook.batchId]);
    expect(saved.lineage).toBe(1); expect(saved.batchStatus).toBe("COMPLETED");
    const [template] = await sqlQuery<{ count: number }>(`SELECT count(*)::int AS count FROM import_mapping_templates WHERE name='客户历史表测试格式' AND business_type='customers'`); expect(template.count).toBe(1);
    const [alias] = await sqlQuery<{ count: number }>(`SELECT count(*)::int AS count FROM entity_aliases WHERE entity_type='company' AND alias=$1`, [company.name.replace("软装", "软装工程")]); expect(alias.count).toBe(1);

    const duplicateWorkbook = await createMigrationWorkbook(makeFile("王经理"), finance); const duplicateMappings = suggestedMappings("customers", duplicateWorkbook.sheets[1].headers);
    const duplicateStage = await stageMigrationBatch({ batchId: duplicateWorkbook.batchId, sheetId: duplicateWorkbook.sheets[1].id, businessType: "customers", mappings: duplicateMappings }, finance);
    expect(duplicateStage.warning).toBe(1); const duplicateDetail = await getMigrationBatch(duplicateWorkbook.batchId, finance); expect(duplicateDetail.rows[0].duplicateStatus).toBe("EXISTING"); expect(duplicateDetail.rows[0].action).toBe("MATCH");
    const financeCompany2 = await financeFor(2); await expect(getMigrationBatch(workbook.batchId, financeCompany2)).rejects.toThrow("权限范围");

    const rollback = await rollbackMigrationBatch(workbook.batchId, finance); expect(rollback.ok).toBe(true);
    const [remaining] = await sqlQuery<{ count: number }>(`SELECT count(*)::int AS count FROM customers WHERE id=$1`, [saved.id]); expect(remaining.count).toBe(0);
    const [rolledBack] = await sqlQuery<{ status: string; lineage: number; jobStatus: string }>(`SELECT status,(SELECT count(*)::int FROM import_data_lineage WHERE batch_id=$1) AS lineage,(SELECT status FROM import_jobs WHERE migration_batch_id=$1) AS "jobStatus" FROM import_batches WHERE id=$1`, [workbook.batchId]); expect(rolledBack.status).toBe("ROLLED_BACK"); expect(rolledBack.lineage).toBe(1); expect(rolledBack.jobStatus).toBe("已撤销");
    const retry = await createMigrationWorkbook(makeFile("陈经理"), finance); const retryMappings = suggestedMappings("customers", retry.sheets[1].headers);
    const retryStage = await stageMigrationBatch({ batchId: retry.batchId, sheetId: retry.sheets[1].id, businessType: "customers", mappings: retryMappings }, finance); expect(retryStage.ready).toBe(1);
    await confirmMigrationBatch(retry.batchId, finance); expect((await importMigrationBatch(retry.batchId, finance)).successRows).toBe(1); expect((await rollbackMigrationBatch(retry.batchId, finance)).ok).toBe(true);
  });

  it("stores attachments, enforces metadata, reads content and preserves void audit", async () => {
    const [project] = await sqlQuery<{ id: number }>("SELECT id FROM projects ORDER BY id LIMIT 1");
    const file = new File(["V1.1 attachment evidence"], "验收凭证.pdf", { type: "application/pdf" });
    const created = await createAttachment({ objectType: "project", objectId: project.id, category: "合同", file }, owner);
    const listed = await getAttachments("project", project.id, owner); expect(listed.some((item) => item.id === created.id)).toBe(true);
    const content = await getAttachmentContent(created.id, owner); expect(content.buffer.toString("utf8")).toBe("V1.1 attachment evidence");
    await voidAttachment(created.id, "集成测试作废", owner);
    const [record] = await sqlQuery<{ isVoid: boolean; logs: number }>(`SELECT is_void AS "isVoid",(SELECT count(*)::int FROM audit_logs WHERE object_type='attachment' AND object_id=$1 AND action='VOID') AS logs FROM attachments WHERE id=$1`, [created.id]);
    expect(record.isVoid).toBe(true); expect(record.logs).toBe(1); await expect(getAttachmentContent(created.id, owner)).rejects.toThrow("已作废");
    const [designer] = await sqlQuery<{ id: number; companyId: number; name: string; email: string }>(`SELECT u.id,u.company_id AS "companyId",u.name,u.email FROM users u JOIN project_members pm ON pm.user_id=u.id WHERE pm.project_id=$1 AND u.role='designer' LIMIT 1`, [project.id]);
    await expect(createAttachment({ objectType: "project", objectId: project.id, category: "其他", file }, { ...designer, role: "designer" })).rejects.toThrow("FORBIDDEN");
  });
});
