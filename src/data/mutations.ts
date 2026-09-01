import { hash } from "bcryptjs";
import { runTransaction, sqlQuery, type TransactionStatement } from "@/db/client";
import type { SessionUser } from "@/lib/auth";
import { assertCan, type ResourceKey } from "@/lib/permissions";
import { writeAudit } from "@/lib/audit";

const cents = (value: unknown) => Math.round(Number(value) * 100);
const int = (value: unknown) => Number.parseInt(String(value), 10);
const decimal = (value: unknown) => Number.parseFloat(String(value));
const text = (value: unknown) => String(value ?? "").trim();

async function getProject(projectId: number, user: SessionUser) {
  const params: unknown[] = [projectId];
  let permission = "";
  if (user.companyId !== null) { params.push(user.companyId); permission += ` AND p.company_id=$${params.length}`; }
  if (user.role === "project_manager" || user.role === "designer") { params.push(user.id); permission += ` AND EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id=p.id AND pm.user_id=$${params.length})`; }
  const [project] = await sqlQuery<{ id: number; companyId: number; customerId: number }>(`SELECT p.id,p.company_id AS "companyId",p.customer_id AS "customerId" FROM projects p WHERE p.id=$1${permission}`, params);
  if (!project) throw new Error("项目不存在或无权访问");
  return project;
}

async function assertCompany(companyId: number, user: SessionUser) {
  if (user.role !== "owner" && user.companyId !== companyId) throw new Error("不能写入其他公司数据");
  const [company] = await sqlQuery<{ id: number }>("SELECT id FROM companies WHERE id=$1", [companyId]);
  if (!company) throw new Error("公司不存在");
}

export async function createResource(resource: ResourceKey, body: Record<string, unknown>, user: SessionUser) {
  assertCan(user, resource, "write");
  let result: Record<string, unknown>;
  let companyId: number | null = user.companyId;
  let projectId: number | null = null;

  switch (resource) {
    case "companies": {
      if (user.role !== "owner") throw new Error("仅老板可新建公司");
      [result] = await sqlQuery(`INSERT INTO companies(code,name,legal_representative,created_by) VALUES($1,$2,$3,$4) RETURNING id,code,name`, [text(body.code), text(body.name), text(body.legalRepresentative), user.id]);
      companyId = Number(result.id);
      break;
    }
    case "accounts": {
      companyId = int(body.companyId); await assertCompany(companyId, user);
      [result] = await sqlQuery(`INSERT INTO company_accounts(company_id,name,type,bank,last_four,balance_cents,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id,name`, [companyId, text(body.name), text(body.type), text(body.bank), text(body.lastFour), cents(body.balanceYuan), user.id]);
      break;
    }
    case "users": {
      companyId = int(body.companyId); await assertCompany(companyId, user);
      const passwordHash = await hash(text(body.password), 10);
      [result] = await sqlQuery(`INSERT INTO users(company_id,name,email,password_hash,role,created_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,name,email`, [companyId, text(body.name), text(body.email), passwordHash, text(body.role), user.id]);
      break;
    }
    case "customers": {
      companyId = int(body.companyId); await assertCompany(companyId, user);
      [result] = await sqlQuery(`INSERT INTO customers(company_id,code,name,type,contact,phone,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id,code,name`, [companyId, text(body.code), text(body.name), text(body.type), text(body.contact), text(body.phone), user.id]);
      break;
    }
    case "suppliers": {
      companyId = int(body.companyId); await assertCompany(companyId, user);
      [result] = await sqlQuery(`INSERT INTO suppliers(company_id,code,name,category,contact,phone,tax_number,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id,code,name`, [companyId, text(body.code), text(body.name), text(body.category), text(body.contact), text(body.phone), text(body.taxNumber), user.id]);
      break;
    }
    case "projects": {
      companyId = int(body.companyId); await assertCompany(companyId, user);
      const [customer] = await sqlQuery<{ id: number }>("SELECT id FROM customers WHERE id=$1 AND company_id=$2", [int(body.customerId), companyId]);
      if (!customer) throw new Error("客户与项目公司不一致");
      const contractAmount = cents(body.contractYuan); const budgetAmount = cents(body.budgetYuan);
      [result] = await sqlQuery(`INSERT INTO projects(company_id,customer_id,code,name,address,owner_id,manager_id,original_contract_cents,current_contract_cents,budget_cents,start_date,expected_end_date,status,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$8,$9,$10,$11,'待启动',$6) RETURNING id,code,name`, [companyId, customer.id, text(body.code), text(body.name), text(body.address), user.id, user.role === "project_manager" ? user.id : null, contractAmount, budgetAmount, body.startDate, body.expectedEndDate]);
      projectId = Number(result.id);
      if (user.role === "project_manager" || user.role === "designer") await sqlQuery("INSERT INTO project_members(project_id,user_id,responsibility,created_by) VALUES($1,$2,$3,$2) ON CONFLICT DO NOTHING", [projectId, user.id, user.role === "designer" ? "设计" : "项目管理"]);
      await sqlQuery("INSERT INTO project_budget_versions(company_id,project_id,version,type,amount_cents,created_by) VALUES($1,$2,1,'原始预算',$3,$4)", [companyId, projectId, budgetAmount, user.id]);
      break;
    }
    case "contracts": {
      projectId = int(body.projectId); const project = await getProject(projectId, user); companyId = project.companyId;
      const status = text(body.status) || "草稿";
      [result] = await sqlQuery(`INSERT INTO contracts(company_id,project_id,number,name,amount_cents,signed_at,status,attachment_url,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id,number,name,status`, [companyId, projectId, text(body.number), text(body.name), cents(body.amountYuan), body.signedAt || null, status, text(body.attachmentUrl) || null, user.id]);
      if (status === "生效中") await sqlQuery("UPDATE projects SET current_contract_cents=$1,updated_at=now(),updated_by=$2 WHERE id=$3", [cents(body.amountYuan), user.id, projectId]);
      break;
    }
    case "receivables": {
      const [contract] = await sqlQuery<{ id: number; projectId: number; companyId: number }>(`SELECT ct.id,ct.project_id AS "projectId",ct.company_id AS "companyId" FROM contracts ct WHERE ct.id=$1 AND NOT ct.is_void`, [int(body.contractId)]);
      if (!contract) throw new Error("合同不存在");
      await getProject(contract.projectId, user); projectId = contract.projectId; companyId = contract.companyId;
      const warranty = text(body.isWarranty) === "true";
      [result] = await sqlQuery(`INSERT INTO receivable_plans(company_id,project_id,contract_id,node_name,ratio_bps,amount_cents,due_date,is_warranty,status,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id,node_name AS "nodeName"`, [companyId, projectId, contract.id, text(body.nodeName), Math.round(Number(body.ratioPercent) * 100), cents(body.amountYuan), body.dueDate, warranty, warranty ? "待释放质保金" : "未到期", user.id]);
      break;
    }
    case "receipts": {
      const planId = int(body.receivablePlanId); const accountId = int(body.accountId); const amount = cents(body.amountYuan);
      const [plan] = await sqlQuery<{ id: number; projectId: number; companyId: number; amountCents: number; receivedCents: number }>(`SELECT id,project_id AS "projectId",company_id AS "companyId",amount_cents AS "amountCents",received_cents AS "receivedCents" FROM receivable_plans WHERE id=$1 AND NOT is_void`, [planId]);
      if (!plan) throw new Error("应收节点不存在"); await getProject(plan.projectId, user); projectId = plan.projectId; companyId = plan.companyId;
      if (amount <= 0 || plan.receivedCents + amount > plan.amountCents) throw new Error("收款金额不能超过应收余额");
      const [account] = await sqlQuery<{ id: number }>("SELECT id FROM company_accounts WHERE id=$1 AND company_id=$2", [accountId, companyId]); if (!account) throw new Error("收款账户与项目公司不一致");
      const receiptResults = await runTransaction([
        { query: `INSERT INTO receipts(company_id,project_id,receivable_plan_id,account_id,number,amount_cents,received_at,bank_receipt_url,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id,number`, params: [companyId, projectId, planId, accountId, text(body.number), amount, body.receivedAt, text(body.bankReceiptUrl) || null, user.id] },
        { query: "UPDATE receivable_plans SET received_cents=received_cents+$1,status=CASE WHEN received_cents+$1>=amount_cents THEN '已收' ELSE '部分收款' END,updated_at=now(),updated_by=$2 WHERE id=$3", params: [amount, user.id, planId] },
        { query: "UPDATE company_accounts SET balance_cents=balance_cents+$1,updated_at=now(),updated_by=$2 WHERE id=$3", params: [amount, user.id, accountId] },
      ]);
      result = receiptResults[0][0];
      break;
    }
    case "skus": {
      projectId = int(body.projectId); const project = await getProject(projectId, user); companyId = project.companyId;
      [result] = await sqlQuery(`INSERT INTO skus(company_id,project_id,code,room,category,name,brand,quantity,unit,budget_unit_cents,image_url,status,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'待询价',$12) RETURNING id,code,name`, [companyId, projectId, text(body.code), text(body.room), text(body.category), text(body.name), text(body.brand), decimal(body.quantity), text(body.unit), cents(body.budgetUnitYuan), text(body.imageUrl) || null, user.id]);
      break;
    }
    case "quotes": {
      const [sku] = await sqlQuery<{ id: number; projectId: number; companyId: number }>(`SELECT id,project_id AS "projectId",company_id AS "companyId" FROM skus WHERE id=$1`, [int(body.skuId)]); if (!sku) throw new Error("SKU 不存在");
      await getProject(sku.projectId, user); projectId = sku.projectId; companyId = sku.companyId;
      const [supplier] = await sqlQuery<{ id: number }>("SELECT id FROM suppliers WHERE id=$1 AND company_id=$2", [int(body.supplierId), companyId]); if (!supplier) throw new Error("供应商与项目公司不一致");
      [result] = await sqlQuery(`INSERT INTO supplier_quotes(company_id,project_id,sku_id,supplier_id,unit_price_cents,tax_rate_bps,freight_cents,install_cents,lead_days,payment_terms,attachment_url,status,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'待核价',$12) RETURNING id`, [companyId, projectId, sku.id, supplier.id, cents(body.unitPriceYuan), Math.round(Number(body.taxRatePercent) * 100), cents(body.freightYuan), cents(body.installYuan), int(body.leadDays), text(body.paymentTerms), text(body.attachmentUrl) || null, user.id]);
      break;
    }
    case "purchase-requests": {
      projectId = int(body.projectId); const project = await getProject(projectId, user); companyId = project.companyId;
      const [sku] = await sqlQuery<{ id: number; quantity: number }>("SELECT id,quantity FROM skus WHERE id=$1 AND project_id=$2", [int(body.skuId), projectId]); if (!sku) throw new Error("SKU 不属于所选项目");
      const [supplier] = await sqlQuery<{ id: number }>("SELECT id FROM suppliers WHERE id=$1 AND company_id=$2", [int(body.supplierId), companyId]); if (!supplier) throw new Error("供应商与项目公司不一致");
      const amount = cents(body.amountYuan);
      [result] = await sqlQuery(`INSERT INTO purchase_requests(company_id,project_id,number,supplier_id,payment_type,amount_cents,requested_by,status,reason,attachment_url,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,'待审批',$8,$9,$7) RETURNING id,number`, [companyId, projectId, text(body.number), supplier.id, text(body.paymentType), amount, user.id, text(body.reason), text(body.attachmentUrl) || null]);
      await sqlQuery("INSERT INTO purchase_request_items(request_id,sku_id,quantity,unit_price_cents,amount_cents,created_by) VALUES($1,$2,$3,$4,$5,$6)", [result.id, sku.id, sku.quantity, Math.round(amount / sku.quantity), amount, user.id]);
      break;
    }
    case "payment-requests": {
      const [payable] = await sqlQuery<{ id: number; projectId: number; companyId: number; remainingCents: number }>(`SELECT id,project_id AS "projectId",company_id AS "companyId",(amount_cents-paid_cents)::float8 AS "remainingCents" FROM payables WHERE id=$1 AND NOT is_void`, [int(body.payableId)]); if (!payable) throw new Error("应付不存在");
      await getProject(payable.projectId, user); projectId = payable.projectId; companyId = payable.companyId;
      const amount = cents(body.amountYuan); if (amount <= 0 || amount > payable.remainingCents) throw new Error("申请金额不能超过应付余额");
      const [account] = await sqlQuery<{ id: number }>("SELECT id FROM company_accounts WHERE id=$1 AND company_id=$2", [int(body.accountId), companyId]); if (!account) throw new Error("付款账户与项目公司不一致");
      [result] = await sqlQuery(`INSERT INTO payment_requests(company_id,project_id,payable_id,number,amount_cents,account_id,requested_by,status,reason,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,'待审批',$8,$7) RETURNING id,number`, [companyId, projectId, payable.id, text(body.number), amount, account.id, user.id, text(body.reason)]);
      break;
    }
    case "payables": {
      const [order] = await sqlQuery<{ id: number; projectId: number; companyId: number; supplierId: number }>(`SELECT id,project_id AS "projectId",company_id AS "companyId",supplier_id AS "supplierId" FROM purchase_orders WHERE id=$1 AND NOT is_void`, [int(body.purchaseOrderId)]); if (!order) throw new Error("采购单不存在");
      await getProject(order.projectId, user); projectId = order.projectId; companyId = order.companyId;
      [result] = await sqlQuery(`INSERT INTO payables(company_id,project_id,supplier_id,purchase_order_id,number,amount_cents,due_date,payment_node,invoice_status,status,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'待付',$10) RETURNING id,number`, [companyId, projectId, order.supplierId, order.id, text(body.number), cents(body.amountYuan), body.dueDate, text(body.paymentNode), text(body.invoiceStatus) || "欠票", user.id]);
      break;
    }
    case "payments": {
      const [payable] = await sqlQuery<{ id: number; projectId: number; companyId: number; amountCents: number; paidCents: number }>(`SELECT id,project_id AS "projectId",company_id AS "companyId",amount_cents AS "amountCents",paid_cents AS "paidCents" FROM payables WHERE id=$1 AND NOT is_void`, [int(body.payableId)]); if (!payable) throw new Error("应付不存在");
      await getProject(payable.projectId, user); projectId = payable.projectId; companyId = payable.companyId; const amount = cents(body.amountYuan);
      if (amount <= 0 || payable.paidCents + amount > payable.amountCents) throw new Error("付款金额超过应付余额");
      const [account] = await sqlQuery<{ id: number; balanceCents: number }>(`SELECT id,balance_cents AS "balanceCents" FROM company_accounts WHERE id=$1 AND company_id=$2`, [int(body.accountId), companyId]); if (!account) throw new Error("付款账户与项目公司不一致"); if (account.balanceCents < amount) throw new Error("付款账户余额不足");
      const paymentResults = await runTransaction([
        { query: `INSERT INTO payments(company_id,project_id,payable_id,account_id,number,amount_cents,paid_at,method,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id,number`, params: [companyId, projectId, payable.id, account.id, text(body.number), amount, body.paidAt, text(body.method) || "银行转账", user.id] },
        { query: "UPDATE payables SET paid_cents=paid_cents+$1,status=CASE WHEN paid_cents+$1>=amount_cents THEN '已付' ELSE '部分付款' END,updated_at=now(),updated_by=$2 WHERE id=$3", params: [amount, user.id, payable.id] },
        { query: "UPDATE company_accounts SET balance_cents=balance_cents-$1,updated_at=now(),updated_by=$2 WHERE id=$3", params: [amount, user.id, account.id] },
      ]);
      result = paymentResults[0][0];
      break;
    }
    case "invoices": {
      const direction = text(body.direction); const amount = cents(body.amountYuan); let statements: TransactionStatement[];
      if (direction === "进项") {
        const [payable] = await sqlQuery<{ id: number; companyId: number; projectId: number; supplierId: number; remainingInvoiceCents: number; amountCents: number }>(`SELECT y.id,y.company_id AS "companyId",y.project_id AS "projectId",y.supplier_id AS "supplierId",y.amount_cents AS "amountCents",(y.amount_cents-COALESCE((SELECT sum(amount_cents) FROM invoice_allocations WHERE payable_id=y.id),0))::float8 AS "remainingInvoiceCents" FROM payables y WHERE y.id=$1 AND NOT y.is_void`, [int(body.payableId)]);
        if (!payable) throw new Error("请选择有效应付进行进项票核销"); await getProject(payable.projectId, user); companyId = payable.companyId; projectId = payable.projectId;
        if (amount <= 0 || amount > payable.remainingInvoiceCents) throw new Error("发票金额超过该应付未核销金额");
        statements = [
          { query: `INSERT INTO invoices(company_id,project_id,supplier_id,number,direction,type,amount_cents,issued_at,created_by) VALUES($1,$2,$3,$4,'进项',$5,$6,$7,$8) RETURNING id,number`, params: [companyId, projectId, payable.supplierId, text(body.number), text(body.type), amount, body.issuedAt, user.id] },
          { query: `INSERT INTO invoice_allocations(company_id,project_id,invoice_id,payable_id,amount_cents,created_by) VALUES($1,$2,$3,$4,$5,$6)`, params: [companyId, projectId, { fromResult: 0, key: "id" }, payable.id, amount, user.id] },
          { query: `UPDATE payables SET invoice_status=CASE WHEN $1>=$2 THEN '已收票' ELSE '部分收票' END,updated_at=now(),updated_by=$3 WHERE id=$4`, params: [amount, payable.remainingInvoiceCents, user.id, payable.id] },
        ];
      } else if (direction === "销项") {
        const [plan] = await sqlQuery<{ id: number; companyId: number; projectId: number; customerId: number; remainingInvoiceCents: number }>(`SELECT rp.id,rp.company_id AS "companyId",rp.project_id AS "projectId",p.customer_id AS "customerId",(rp.amount_cents-COALESCE((SELECT sum(amount_cents) FROM invoice_allocations WHERE receivable_plan_id=rp.id),0))::float8 AS "remainingInvoiceCents" FROM receivable_plans rp JOIN projects p ON p.id=rp.project_id WHERE rp.id=$1 AND NOT rp.is_void`, [int(body.receivablePlanId)]);
        if (!plan) throw new Error("请选择有效应收节点进行销项票核销"); await getProject(plan.projectId, user); companyId = plan.companyId; projectId = plan.projectId;
        if (amount <= 0 || amount > plan.remainingInvoiceCents) throw new Error("发票金额超过该应收节点未核销金额");
        statements = [
          { query: `INSERT INTO invoices(company_id,project_id,customer_id,number,direction,type,amount_cents,issued_at,created_by) VALUES($1,$2,$3,$4,'销项',$5,$6,$7,$8) RETURNING id,number`, params: [companyId, projectId, plan.customerId, text(body.number), text(body.type), amount, body.issuedAt, user.id] },
          { query: `INSERT INTO invoice_allocations(company_id,project_id,invoice_id,receivable_plan_id,amount_cents,created_by) VALUES($1,$2,$3,$4,$5,$6)`, params: [companyId, projectId, { fromResult: 0, key: "id" }, plan.id, amount, user.id] },
        ];
      } else throw new Error("发票方向无效");
      const invoiceResults = await runTransaction(statements); result = invoiceResults[0][0];
      break;
    }
    case "returns": {
      const orderId = int(body.purchaseOrderId); const type = text(body.type); const quantity = decimal(body.quantity || 0); let amount = cents(body.amountYuan || 0);
      const [order] = await sqlQuery<{ id: number; companyId: number; projectId: number; amountCents: number; deliveredCents: number; payableId: number; paidCents: number }>(`SELECT po.id,po.company_id AS "companyId",po.project_id AS "projectId",po.amount_cents AS "amountCents",po.delivered_cents AS "deliveredCents",y.id AS "payableId",y.paid_cents AS "paidCents" FROM purchase_orders po LEFT JOIN payables y ON y.purchase_order_id=po.id AND NOT y.is_void WHERE po.id=$1 AND NOT po.is_void`, [orderId]);
      if (!order) throw new Error("采购订单不存在"); await getProject(order.projectId, user); companyId = order.companyId; projectId = order.projectId;
      const baseInsert = { query: `INSERT INTO purchase_returns(company_id,project_id,purchase_order_id,payable_id,number,type,amount_cents,quantity,reason,status,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id,number,type,status`, params: [companyId, projectId, order.id, order.payableId, text(body.number), type, amount, quantity, text(body.reason), type === "换货" ? "待补货" : "已完成", user.id] };
      const statements: TransactionStatement[] = [];
      if (type === "采购取消") {
        if (Number(order.deliveredCents) > 0 || Number(order.paidCents) > 0) throw new Error("已到货或已付款订单不能直接取消，请走退货/退款"); amount = Number(order.amountCents); baseInsert.params![6] = amount; statements.push(baseInsert, { query: "UPDATE purchase_orders SET is_void=true,void_reason=$1,status='已取消',version=version+1,updated_at=now(),updated_by=$2 WHERE id=$3", params: [text(body.reason), user.id, order.id] }, { query: "UPDATE payables SET is_void=true,void_reason=$1,status='已取消',amount_cents=0,version=version+1,updated_at=now(),updated_by=$2 WHERE id=$3", params: [text(body.reason), user.id, order.payableId] });
      } else if (type === "退货") {
        if (amount <= 0 || amount > Number(order.amountCents)) throw new Error("退货金额必须大于 0 且不能超过订单金额"); if (quantity <= 0) throw new Error("退货数量必须大于 0");
        statements.push(baseInsert, { query: "UPDATE purchase_orders SET amount_cents=amount_cents-$1,delivered_cents=GREATEST(0,delivered_cents-$1),status='部分退货',version=version+1,updated_at=now(),updated_by=$2 WHERE id=$3", params: [amount, user.id, order.id] }, { query: "UPDATE payables SET amount_cents=GREATEST(0,amount_cents-$1),status=CASE WHEN paid_cents>GREATEST(0,amount_cents-$1) THEN '待退款' WHEN paid_cents=GREATEST(0,amount_cents-$1) THEN '已付' ELSE '部分付款' END,version=version+1,updated_at=now(),updated_by=$2 WHERE id=$3", params: [amount, user.id, order.payableId] }, { query: "UPDATE inventory_batches SET remaining_quantity=GREATEST(0,remaining_quantity-$1),status=CASE WHEN remaining_quantity-$1<=0 THEN '已出库' ELSE '部分在库' END,updated_at=now(),updated_by=$2 WHERE purchase_order_id=$3", params: [quantity, user.id, order.id] }, { query: "INSERT INTO inventory_transactions(company_id,project_id,batch_id,type,quantity,amount_cents,happened_at,note,created_by) SELECT company_id,project_id,id,'退货出库',$1,$2,now(),$3,$4 FROM inventory_batches WHERE purchase_order_id=$5 ORDER BY id LIMIT 1", params: [quantity, amount, text(body.reason), user.id, order.id] });
      } else if (type === "换货") {
        if (quantity <= 0) throw new Error("换货数量必须大于 0"); amount = 0; baseInsert.params![6] = 0; statements.push(baseInsert, { query: "UPDATE purchase_orders SET status='换货处理中',version=version+1,updated_at=now(),updated_by=$1 WHERE id=$2", params: [user.id, order.id] }, { query: "UPDATE inventory_batches SET remaining_quantity=GREATEST(0,remaining_quantity-$1),status='换货处理中',updated_at=now(),updated_by=$2 WHERE purchase_order_id=$3", params: [quantity, user.id, order.id] }, { query: "INSERT INTO inventory_transactions(company_id,project_id,batch_id,type,quantity,amount_cents,happened_at,note,created_by) SELECT company_id,project_id,id,'换货出库',$1,0,now(),$2,$3 FROM inventory_batches WHERE purchase_order_id=$4 ORDER BY id LIMIT 1", params: [quantity, text(body.reason), user.id, order.id] });
      } else if (type === "退款") {
        const accountId = int(body.accountId); if (amount <= 0 || amount > Number(order.paidCents)) throw new Error("退款金额必须大于 0 且不能超过已付款");
        const [account] = await sqlQuery<{ id: number }>("SELECT id FROM company_accounts WHERE id=$1 AND company_id=$2 AND status='active'", [accountId, companyId]); if (!account) throw new Error("退款账户无效");
        statements.push(baseInsert, { query: "UPDATE payables SET paid_cents=GREATEST(0,paid_cents-$1),status=CASE WHEN GREATEST(0,paid_cents-$1)=0 THEN '待付' ELSE '部分付款' END,version=version+1,updated_at=now(),updated_by=$2 WHERE id=$3", params: [amount, user.id, order.payableId] }, { query: "UPDATE company_accounts SET balance_cents=balance_cents+$1,updated_at=now(),updated_by=$2 WHERE id=$3", params: [amount, user.id, account.id] });
      } else throw new Error("不支持的采购异常类型");
      const returnResults = await runTransaction(statements); result = returnResults[0][0];
      break;
    }
    default: throw new Error("该模块暂不支持直接新增");
  }

  await writeAudit({ user, companyId, projectId, objectType: resource, objectId: Number(result.id), action: "CREATE", after: result });
  return result;
}

const editableTables: Partial<Record<ResourceKey, string>> = {
  accounts: "company_accounts", customers: "customers", suppliers: "suppliers", projects: "projects",
  contracts: "contracts", receivables: "receivable_plans", skus: "skus", quotes: "supplier_quotes",
  "purchase-requests": "purchase_requests", "payment-requests": "payment_requests",
};

export async function updateResource(resource: ResourceKey, id: number, body: Record<string, unknown>, user: SessionUser) {
  assertCan(user, resource, "write");
  const table = editableTables[resource];
  if (!table) throw new Error("该对象不能直接修改");
  const [before] = await sqlQuery<Record<string, unknown>>(`SELECT * FROM ${table} WHERE id=$1`, [id]);
  if (!before || before.is_void === true) throw new Error("对象不存在或已作废");
  const companyId = Number(before.company_id ?? before.id);
  if (user.role !== "owner" && companyId !== user.companyId) throw new Error("无权修改其他公司数据");
  const projectId = Number(before.project_id) || null;
  if (projectId) await getProject(projectId, user);

  switch (resource) {
    case "accounts":
      await sqlQuery(`UPDATE company_accounts SET name=$1,type=$2,bank=$3,last_four=$4,balance_cents=$5,updated_at=now(),updated_by=$6 WHERE id=$7`, [text(body.name), text(body.type), text(body.bank), text(body.lastFour), cents(body.balanceYuan), user.id, id]);
      break;
    case "customers":
      await sqlQuery(`UPDATE customers SET code=$1,name=$2,type=$3,contact=$4,phone=$5,updated_at=now(),updated_by=$6 WHERE id=$7`, [text(body.code), text(body.name), text(body.type), text(body.contact), text(body.phone), user.id, id]);
      break;
    case "suppliers":
      await sqlQuery(`UPDATE suppliers SET code=$1,name=$2,category=$3,contact=$4,phone=$5,tax_number=$6,updated_at=now(),updated_by=$7 WHERE id=$8`, [text(body.code), text(body.name), text(body.category), text(body.contact), text(body.phone), text(body.taxNumber), user.id, id]);
      break;
    case "projects": {
      const customerId = int(body.customerId);
      const [customer] = await sqlQuery<{ id: number }>("SELECT id FROM customers WHERE id=$1 AND company_id=$2", [customerId, companyId]);
      if (!customer) throw new Error("客户与项目公司不一致");
      const budget = cents(body.budgetYuan);
      await runTransaction([
        { query: `UPDATE projects SET customer_id=$1,name=$2,address=$3,budget_cents=$4,start_date=$5,expected_end_date=$6,updated_at=now(),updated_by=$7 WHERE id=$8`, params: [customerId, text(body.name), text(body.address), budget, body.startDate, body.expectedEndDate, user.id, id] },
        ...(Number(before.budget_cents) !== budget ? [{ query: `INSERT INTO project_budget_versions(company_id,project_id,version,type,amount_cents,note,created_by) SELECT $1,$2,COALESCE(max(version),0)+1,'纠错版本',$3,$4,$5 FROM project_budget_versions WHERE project_id=$2`, params: [companyId, id, budget, "项目资料安全修改自动生成", user.id] }] : []),
      ]);
      break;
    }
    case "contracts": {
      if (before.status !== "草稿") throw new Error("仅合同草稿可直接修改，生效合同请作废后创建新版本");
      const [plan] = await sqlQuery<{ id: number }>("SELECT id FROM receivable_plans WHERE contract_id=$1 AND NOT is_void LIMIT 1", [id]);
      if (plan) throw new Error("已生成应收计划的合同不能直接修改");
      await sqlQuery(`UPDATE contracts SET number=$1,name=$2,amount_cents=$3,signed_at=$4,attachment_url=$5,version=version+1,updated_at=now(),updated_by=$6 WHERE id=$7`, [text(body.number), text(body.name), cents(body.amountYuan), body.signedAt || null, text(body.attachmentUrl) || null, user.id, id]);
      break;
    }
    case "receivables":
      if (Number(before.received_cents) > 0) throw new Error("已发生收款的应收节点不能直接修改，请作废或新建调整节点");
      await sqlQuery(`UPDATE receivable_plans SET node_name=$1,ratio_bps=$2,amount_cents=$3,due_date=$4,is_warranty=$5,version=version+1,updated_at=now(),updated_by=$6 WHERE id=$7`, [text(body.nodeName), Math.round(Number(body.ratioPercent) * 100), cents(body.amountYuan), body.dueDate, text(body.isWarranty) === "true", user.id, id]);
      break;
    case "skus":
      if (before.status === "已下单") throw new Error("已下单 SKU 不能直接修改，请走采购变更或退换货");
      await sqlQuery(`UPDATE skus SET code=$1,room=$2,category=$3,name=$4,brand=$5,quantity=$6,unit=$7,budget_unit_cents=$8,image_url=$9,updated_at=now(),updated_by=$10 WHERE id=$11`, [text(body.code), text(body.room), text(body.category), text(body.name), text(body.brand), decimal(body.quantity), text(body.unit), cents(body.budgetUnitYuan), text(body.imageUrl) || null, user.id, id]);
      break;
    case "quotes":
      if (!["待核价", "未选中"].includes(String(before.status))) throw new Error("已选中或已确认报价不能直接修改");
      await sqlQuery(`UPDATE supplier_quotes SET supplier_id=$1,unit_price_cents=$2,tax_rate_bps=$3,freight_cents=$4,install_cents=$5,lead_days=$6,payment_terms=$7,attachment_url=$8,updated_at=now(),updated_by=$9 WHERE id=$10`, [int(body.supplierId), cents(body.unitPriceYuan), Math.round(Number(body.taxRatePercent) * 100), cents(body.freightYuan), cents(body.installYuan), int(body.leadDays), text(body.paymentTerms), text(body.attachmentUrl) || null, user.id, id]);
      break;
    case "purchase-requests": {
      if (!["草稿", "待审批"].includes(String(before.status))) throw new Error("仅未审批采购申请可直接修改");
      const [sku] = await sqlQuery<{ id: number; quantity: number }>("SELECT id,quantity FROM skus WHERE id=$1 AND project_id=$2", [int(body.skuId), projectId]);
      const [supplier] = await sqlQuery<{ id: number }>("SELECT id FROM suppliers WHERE id=$1 AND company_id=$2", [int(body.supplierId), companyId]);
      if (!sku || !supplier) throw new Error("SKU、供应商与申请范围不一致");
      const amount = cents(body.amountYuan);
      await runTransaction([
        { query: `UPDATE purchase_requests SET supplier_id=$1,number=$2,payment_type=$3,amount_cents=$4,reason=$5,attachment_url=$6,version=version+1,updated_at=now(),updated_by=$7 WHERE id=$8`, params: [supplier.id, text(body.number), text(body.paymentType), amount, text(body.reason), text(body.attachmentUrl) || null, user.id, id] },
        { query: `UPDATE purchase_request_items SET sku_id=$1,quantity=$2,unit_price_cents=$3,amount_cents=$4,updated_at=now(),updated_by=$5 WHERE id=(SELECT id FROM purchase_request_items WHERE request_id=$6 ORDER BY id LIMIT 1)`, params: [sku.id, sku.quantity, Math.round(amount / Number(sku.quantity)), amount, user.id, id] },
      ]);
      break;
    }
    case "payment-requests": {
      if (before.status !== "待审批") throw new Error("仅未审批付款申请可直接修改");
      const [payable] = await sqlQuery<{ id: number; projectId: number; companyId: number; remaining: number }>(`SELECT id,project_id AS "projectId",company_id AS "companyId",(amount_cents-paid_cents)::float8 AS remaining FROM payables WHERE id=$1 AND NOT is_void`, [int(body.payableId)]);
      if (!payable || payable.companyId !== companyId || payable.projectId !== projectId) throw new Error("应付与付款申请范围不一致");
      const [account] = await sqlQuery<{ id: number }>("SELECT id FROM company_accounts WHERE id=$1 AND company_id=$2 AND status='active'", [int(body.accountId), companyId]);
      const amount = cents(body.amountYuan);
      if (!account || amount <= 0 || amount > payable.remaining) throw new Error("付款账户无效或申请金额超过应付余额");
      await sqlQuery(`UPDATE payment_requests SET payable_id=$1,account_id=$2,number=$3,amount_cents=$4,reason=$5,version=version+1,updated_at=now(),updated_by=$6 WHERE id=$7`, [payable.id, account.id, text(body.number), amount, text(body.reason), user.id, id]);
      break;
    }
  }

  const [after] = await sqlQuery<Record<string, unknown>>(`SELECT * FROM ${table} WHERE id=$1`, [id]);
  await writeAudit({ user, companyId, projectId, objectType: resource, objectId: id, action: "UPDATE", before, after });
  return after;
}

export async function voidResource(resource: ResourceKey, id: number, reason: string, user: SessionUser) {
  assertCan(user, resource, "write");
  const tables: Partial<Record<ResourceKey, string>> = { contracts: "contracts", receivables: "receivable_plans", receipts: "receipts", "purchase-requests": "purchase_requests", "purchase-orders": "purchase_orders", payables: "payables", "payment-requests": "payment_requests", payments: "payments", invoices: "invoices", returns: "purchase_returns" };
  const table = tables[resource]; if (!table) throw new Error("该对象不能作废");
  const [before] = await sqlQuery<Record<string, unknown>>(`SELECT * FROM ${table} WHERE id=$1`, [id]); if (!before) throw new Error("对象不存在");
  if (before.is_void === true) throw new Error("对象已经作废");
  const companyId = Number(before.company_id); if (user.role !== "owner" && companyId !== user.companyId) throw new Error("无权操作其他公司数据");
  if (!reason.trim()) throw new Error("请填写作废或冲销原因");
  if (resource === "payments") {
    if (user.role !== "finance") throw new Error("仅财务可以冲销已付款");
    await runTransaction([
      { query: "UPDATE payments SET is_void=true,void_reason=$1,status='已冲销',version=version+1,updated_at=now(),updated_by=$2 WHERE id=$3", params: [reason, user.id, id] },
      { query: "UPDATE payables SET paid_cents=GREATEST(0,paid_cents-$1),status=CASE WHEN GREATEST(0,paid_cents-$1)=0 THEN '待付' ELSE '部分付款' END,version=version+1,updated_at=now(),updated_by=$2 WHERE id=$3", params: [Number(before.amount_cents), user.id, Number(before.payable_id)] },
      { query: "UPDATE company_accounts SET balance_cents=balance_cents+$1,updated_at=now(),updated_by=$2 WHERE id=$3", params: [Number(before.amount_cents), user.id, Number(before.account_id)] },
      { query: "UPDATE payment_requests SET status='已通过',version=version+1,updated_at=now(),updated_by=$1 WHERE id=$2 AND status='已付款'", params: [user.id, Number(before.payment_request_id)] },
    ]);
  } else if (resource === "receipts") {
    if (user.role !== "finance") throw new Error("仅财务可以撤销收款");
    await runTransaction([
      { query: "UPDATE receipts SET is_void=true,void_reason=$1,status='已撤销',version=version+1,updated_at=now(),updated_by=$2 WHERE id=$3", params: [reason, user.id, id] },
      { query: "UPDATE receivable_plans SET received_cents=GREATEST(0,received_cents-$1),status=CASE WHEN GREATEST(0,received_cents-$1)=0 THEN '未到期' ELSE '部分收款' END,version=version+1,updated_at=now(),updated_by=$2 WHERE id=$3", params: [Number(before.amount_cents), user.id, Number(before.receivable_plan_id)] },
      { query: "UPDATE company_accounts SET balance_cents=balance_cents-$1,updated_at=now(),updated_by=$2 WHERE id=$3", params: [Number(before.amount_cents), user.id, Number(before.account_id)] },
    ]);
  } else if (resource === "invoices") {
    await runTransaction([
      { query: "UPDATE invoices SET is_void=true,void_reason=$1,status='已作废',version=version+1,updated_at=now(),updated_by=$2 WHERE id=$3", params: [reason, user.id, id] },
      { query: "UPDATE payables SET invoice_status='欠票',updated_at=now(),updated_by=$1 WHERE id IN (SELECT payable_id FROM invoice_allocations WHERE invoice_id=$2)", params: [user.id, id] },
      { query: "DELETE FROM invoice_allocations WHERE invoice_id=$1", params: [id] },
    ]);
  } else {
    if (resource === "contracts" && await sqlQuery("SELECT id FROM receivable_plans WHERE contract_id=$1 AND NOT is_void LIMIT 1", [id]).then((rows) => rows[0])) throw new Error("合同已有应收计划，不能直接作废");
    if (resource === "receivables" && Number(before.received_cents) > 0) throw new Error("应收节点已有收款，必须先撤销收款");
    if (resource === "payables" && Number(before.paid_cents) > 0) throw new Error("应付已有付款，必须先冲销付款");
    if (resource === "payment-requests" && !["待审批", "已驳回"].includes(String(before.status))) throw new Error("已审批付款申请不能直接作废");
    await sqlQuery(`UPDATE ${table} SET is_void=true,void_reason=$1,status='已作废',version=version+1,updated_at=now(),updated_by=$2 WHERE id=$3`, [reason, user.id, id]);
  }
  await writeAudit({ user, companyId, projectId: Number(before.project_id) || null, objectType: resource, objectId: id, action: "VOID", before, after: { isVoid: true, voidReason: reason } });
}
