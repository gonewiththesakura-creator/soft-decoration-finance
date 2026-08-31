import { describe, expect, it } from "vitest";
import { sqlQuery } from "@/db/client";
import { decidePayment, decidePurchase, executePayment } from "@/data/workflows";
import { createResource } from "@/data/mutations";
import { getResourceData } from "@/data/resources";
import type { SessionUser } from "@/lib/auth";

const owner: SessionUser = { id: 1, companyId: null, name: "陈屿", email: "owner@zhiheng.local", role: "owner" };

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
    const [plan] = await sqlQuery<{ id: number; companyId: number; projectId: number; remaining: number; receivedCents: number }>(`SELECT id,company_id AS "companyId",project_id AS "projectId",received_cents AS "receivedCents",(amount_cents-received_cents)::int AS remaining FROM receivable_plans WHERE NOT is_void AND NOT is_warranty AND received_cents<amount_cents ORDER BY id LIMIT 1`);
    const [account] = await sqlQuery<{ id: number; balance: number }>(`SELECT id,balance_cents AS balance FROM company_accounts WHERE company_id=$1 ORDER BY id LIMIT 1`, [plan.companyId]);
    const amount = Math.min(10_000, plan.remaining);
    await createResource("receipts", { receivablePlanId: plan.id, accountId: account.id, number: `TEST-SK-${Date.now()}`, amountYuan: amount / 100, receivedAt: "2026-08-31" }, owner);
    const [after] = await sqlQuery<{ receivedCents: number; accountBalance: number; logs: number }>(`SELECT (SELECT received_cents FROM receivable_plans WHERE id=$1) AS "receivedCents",(SELECT balance_cents FROM company_accounts WHERE id=$2) AS "accountBalance",(SELECT count(*)::int FROM audit_logs WHERE object_type='receipts' AND action='CREATE') AS logs`, [plan.id, account.id]);
    expect(after.receivedCents).toBe(plan.receivedCents + amount);
    expect(after.accountBalance).toBe(account.balance + amount);
    expect(after.logs).toBeGreaterThan(0);
  });

  it("approves and executes a payment with payable and account balance updates", async () => {
    const [request] = await sqlQuery<{ id: number; payableId: number; accountId: number; amountCents: number }>(`SELECT id,payable_id AS "payableId",account_id AS "accountId",amount_cents AS "amountCents" FROM payment_requests WHERE status='待审批' ORDER BY id LIMIT 1`);
    const [before] = await sqlQuery<{ paidCents: number; balanceCents: number }>(`SELECT y.paid_cents AS "paidCents",a.balance_cents AS "balanceCents" FROM payables y JOIN company_accounts a ON a.id=$2 WHERE y.id=$1`, [request.payableId, request.accountId]);
    await decidePayment(request.id, "approve", "集成测试通过", owner);
    const payment = await executePayment(request.id, owner);
    const [after] = await sqlQuery<{ status: string; paidCents: number; balanceCents: number }>(`SELECT r.status,y.paid_cents AS "paidCents",a.balance_cents AS "balanceCents" FROM payment_requests r JOIN payables y ON y.id=r.payable_id JOIN company_accounts a ON a.id=r.account_id WHERE r.id=$1`, [request.id]);
    expect(payment.number).toMatch(/^FK-/);
    expect(after.status).toBe("已付款");
    expect(after.paidCents).toBe(before.paidCents + request.amountCents);
    expect(after.balanceCents).toBe(before.balanceCents - request.amountCents);
  });
});
