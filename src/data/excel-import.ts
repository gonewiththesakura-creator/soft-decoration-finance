import { createHash } from "node:crypto";
import { runTransaction, sqlQuery, type TransactionParam, type TransactionStatement } from "@/db/client";
import type { SessionUser } from "@/lib/auth";
import { assertCan, type ResourceKey } from "@/lib/permissions";
import { validateNormalizedRows } from "./excel";

export type ImportError = { row: number; field: string; message: string };
const text = (value: unknown) => String(value ?? "").trim(); const num = (value: unknown) => value === "" || value === null || value === undefined ? 0 : Number(value); const cents = (value: unknown) => Math.round(num(value) * 100);
const uniqueConfig: Partial<Record<ResourceKey, { table: string; column: string; key: string; company?: boolean }>> = {
  companies: { table: "companies", column: "code", key: "code" }, customers: { table: "customers", column: "code", key: "code", company: true }, suppliers: { table: "suppliers", column: "code", key: "code", company: true }, projects: { table: "projects", column: "code", key: "code" }, contracts: { table: "contracts", column: "number", key: "number" }, receipts: { table: "receipts", column: "number", key: "number" }, skus: { table: "skus", column: "code", key: "code" }, "purchase-requests": { table: "purchase_requests", column: "number", key: "number" }, payables: { table: "payables", column: "number", key: "number" }, payments: { table: "payments", column: "number", key: "number" }, invoices: { table: "invoices", column: "number", key: "number" },
};

async function one(query: string, params: unknown[]) { return (await sqlQuery<Record<string, unknown>>(query, params))[0]; }
function add(errors: ImportError[], row: number, field: string, message: string) { errors.push({ row: row + 2, field, message }); }

export async function preflightImport(resource: ResourceKey, rows: Record<string, unknown>[], user: SessionUser) {
  assertCan(user, "imports", "write"); assertCan(user, resource, "write");
  const errors = validateNormalizedRows(resource, rows);
  const sourceHash = createHash("sha256").update(JSON.stringify({ resource, rows })).digest("hex");
  const duplicate = await one("SELECT id FROM import_jobs WHERE source_hash=$1 AND status='已完成'", [sourceHash]);
  if (duplicate) errors.push({ row: 0, field: "文件", message: "同一批数据已经成功导入，请勿重复提交" });
  const seen = new Set<string>(); const config = uniqueConfig[resource]; let firstCompanyId: number | null = null;
  const receiptTotals = new Map<number, number>(); const paymentTotals = new Map<number, number>(); const accountPaymentTotals = new Map<number, number>();

  for (const [index, row] of rows.entries()) {
    for (const key of Object.keys(row).filter((key) => key.endsWith("Yuan"))) {
      const value = cents(row[key]); if (!Number.isSafeInteger(value)) add(errors, index, key, "金额超出应用安全计算范围"); else if (key !== "balanceYuan" && value <= 0) add(errors, index, key, "金额必须大于 0");
    }
    if ("quantity" in row) { const quantity = num(row.quantity); if (!(quantity > 0) || Math.round(quantity * 10_000) !== quantity * 10_000) add(errors, index, "数量", "数量必须大于 0 且最多 4 位小数"); }

    let companyId = resource === "companies" ? null : num(row.companyId);
    let projectId: number | null = null;
    if (resource === "projects") projectId = null;
    if (["contracts", "skus", "purchase-requests", "invoices"].includes(resource)) projectId = num(row.projectId);
    if (resource === "accounts" || resource === "customers" || resource === "suppliers" || resource === "projects") {
      const company = await one("SELECT id FROM companies WHERE id=$1", [companyId]); if (!company) add(errors, index, "公司ID", "公司不存在");
    } else if (projectId) {
      const project = await one("SELECT id,company_id FROM projects WHERE id=$1", [projectId]); if (!project) add(errors, index, "项目ID", "项目不存在"); else companyId = Number(project.company_id);
    } else if (resource === "receivables") {
      const contract = await one("SELECT id,company_id,project_id FROM contracts WHERE id=$1 AND NOT is_void", [num(row.contractId)]); if (!contract) add(errors, index, "合同ID", "合同不存在"); else { companyId = Number(contract.company_id); projectId = Number(contract.project_id); }
    } else if (resource === "receipts") {
      const plan = await one("SELECT id,company_id,project_id,(amount_cents-received_cents)::float8 AS remaining FROM receivable_plans WHERE id=$1 AND NOT is_void", [num(row.receivablePlanId)]); if (!plan) add(errors, index, "应收节点ID", "应收节点不存在"); else { companyId = Number(plan.company_id); projectId = Number(plan.project_id); const total = (receiptTotals.get(num(row.receivablePlanId)) ?? 0) + cents(row.amountYuan); receiptTotals.set(num(row.receivablePlanId), total); if (total > Number(plan.remaining)) add(errors, index, "收款金额(元)", "本批收款合计超过应收余额"); }
    } else if (resource === "quotes") {
      const sku = await one("SELECT id,company_id,project_id FROM skus WHERE id=$1", [num(row.skuId)]); if (!sku) add(errors, index, "SKUID", "SKU 不存在"); else { companyId = Number(sku.company_id); projectId = Number(sku.project_id); }
    } else if (resource === "payables") {
      const order = await one("SELECT id,company_id,project_id FROM purchase_orders WHERE id=$1 AND NOT is_void", [num(row.purchaseOrderId)]); if (!order) add(errors, index, "采购单ID", "采购单不存在"); else { companyId = Number(order.company_id); projectId = Number(order.project_id); }
    } else if (resource === "payments") {
      const payable = await one("SELECT id,company_id,project_id,(amount_cents-paid_cents)::float8 AS remaining FROM payables WHERE id=$1 AND NOT is_void", [num(row.payableId)]); if (!payable) add(errors, index, "应付ID", "应付不存在"); else { companyId = Number(payable.company_id); projectId = Number(payable.project_id); const total = (paymentTotals.get(num(row.payableId)) ?? 0) + cents(row.amountYuan); paymentTotals.set(num(row.payableId), total); if (total > Number(payable.remaining)) add(errors, index, "付款金额(元)", "本批付款合计超过应付余额"); }
    }
    if (companyId) { firstCompanyId ??= companyId; if (user.role !== "owner" && user.companyId !== companyId) add(errors, index, "公司范围", "不能导入其他公司数据"); }

    if (resource === "projects") { const customer = await one("SELECT id FROM customers WHERE id=$1 AND company_id=$2", [num(row.customerId), companyId]); if (!customer) add(errors, index, "客户ID", "客户与项目公司不一致"); }
    if (["quotes", "purchase-requests"].includes(resource)) { const supplier = await one("SELECT id FROM suppliers WHERE id=$1 AND company_id=$2", [num(row.supplierId), companyId]); if (!supplier) add(errors, index, "供应商ID", "供应商与项目公司不一致"); }
    if (resource === "purchase-requests") { const sku = await one("SELECT id FROM skus WHERE id=$1 AND project_id=$2", [num(row.skuId), projectId]); if (!sku) add(errors, index, "SKUID", "SKU 不属于所选项目"); }
    if (resource === "invoices" && text(row.direction) === "进项") { const supplier = await one("SELECT id FROM suppliers WHERE id=$1 AND company_id=$2", [num(row.supplierId), companyId]); if (!supplier) add(errors, index, "供应商ID", "进项发票供应商与项目公司不一致"); }
    if (resource === "receipts" || resource === "payments") {
      const account = await one("SELECT id,balance_cents FROM company_accounts WHERE id=$1 AND company_id=$2 AND status='active'", [num(row.accountId), companyId]); if (!account) add(errors, index, "账户ID", "账户与业务公司不一致或已停用");
      if (resource === "payments" && account) { const total = (accountPaymentTotals.get(num(row.accountId)) ?? 0) + cents(row.amountYuan); accountPaymentTotals.set(num(row.accountId), total); if (total > Number(account.balance_cents)) add(errors, index, "付款金额(元)", "本批付款合计超过账户余额"); }
    }

    if (config) {
      const value = text(row[config.key]); const localKey = `${config.company ? companyId : "global"}:${value.toLowerCase()}`;
      if (seen.has(localKey)) add(errors, index, config.key, "文件内存在重复唯一值"); else seen.add(localKey);
      const params: unknown[] = [value]; let condition = `${config.column}=$1`;
      if (config.company) { params.push(companyId); condition += " AND company_id=$2"; }
      if (value && await one(`SELECT id FROM ${config.table} WHERE ${condition} LIMIT 1`, params)) add(errors, index, config.key, "数据库中已存在相同唯一值");
    }
  }
  return { errors, sourceHash, companyId: firstCompanyId };
}

function auditStatement(table: string, resultIndex: number, resource: string, userId: number, hasCompany = true, hasProject = true): TransactionStatement {
  const company = hasCompany ? "company_id" : "id"; const project = hasProject ? "project_id" : "NULL";
  return { query: `INSERT INTO audit_logs(company_id,project_id,user_id,object_type,object_id,action,after,ip) SELECT ${company},${project},$1,$2,id,'IMPORT',to_jsonb(t),'127.0.0.1' FROM ${table} t WHERE id=$3`, params: [userId, resource, { fromResult: resultIndex, key: "id" }] };
}

export async function importRowsAtomic(resource: ResourceKey, rows: Record<string, unknown>[], filename: string, sourceHash: string, companyId: number | null, user: SessionUser) {
  const statements: TransactionStatement[] = []; let firstCompanyResult: TransactionParam | null = null;
  const push = (query: string, params: TransactionParam[], table: string, hasCompany = true, hasProject = true) => { const index = statements.length; statements.push({ query, params }); firstCompanyResult ??= table === "companies" ? { fromResult: index, key: "id" } : null; statements.push(auditStatement(table, index, resource, user.id, hasCompany, hasProject)); return index; };
  for (const row of rows) {
    switch (resource) {
      case "companies": push("INSERT INTO companies(code,name,legal_representative,created_by) VALUES($1,$2,$3,$4) RETURNING id", [text(row.code), text(row.name), text(row.legalRepresentative), user.id], "companies", false, false); break;
      case "accounts": push("INSERT INTO company_accounts(company_id,name,type,bank,last_four,balance_cents,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id", [num(row.companyId), text(row.name), text(row.type), text(row.bank), text(row.lastFour), cents(row.balanceYuan), user.id], "company_accounts", true, false); break;
      case "customers": push("INSERT INTO customers(company_id,code,name,type,contact,phone,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id", [num(row.companyId), text(row.code), text(row.name), text(row.type), text(row.contact), text(row.phone), user.id], "customers", true, false); break;
      case "suppliers": push("INSERT INTO suppliers(company_id,code,name,category,contact,phone,tax_number,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id", [num(row.companyId), text(row.code), text(row.name), text(row.category), text(row.contact), text(row.phone), text(row.taxNumber), user.id], "suppliers", true, false); break;
      case "projects": { const index = push("INSERT INTO projects(company_id,customer_id,code,name,address,owner_id,original_contract_cents,current_contract_cents,budget_cents,start_date,expected_end_date,status,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$7,$8,$9,$10,'待启动',$6) RETURNING id", [num(row.companyId), num(row.customerId), text(row.code), text(row.name), text(row.address), user.id, cents(row.contractYuan), cents(row.budgetYuan), row.startDate, row.expectedEndDate], "projects"); statements.push({ query: "INSERT INTO project_budget_versions(company_id,project_id,version,type,amount_cents,created_by) VALUES($1,$2,1,'原始预算',$3,$4)", params: [num(row.companyId), { fromResult: index, key: "id" }, cents(row.budgetYuan), user.id] }); break; }
      case "contracts": push("INSERT INTO contracts(company_id,project_id,number,name,amount_cents,signed_at,status,created_by) SELECT company_id,id,$2,$3,$4,$5,'草稿',$6 FROM projects WHERE id=$1 RETURNING id", [num(row.projectId), text(row.number), text(row.name), cents(row.amountYuan), row.signedAt, user.id], "contracts"); break;
      case "receivables": push("INSERT INTO receivable_plans(company_id,project_id,contract_id,node_name,ratio_bps,amount_cents,due_date,is_warranty,status,created_by) SELECT company_id,project_id,id,$2,$3,$4,$5,$6,CASE WHEN $6 THEN '待释放质保金' ELSE '未到期' END,$7 FROM contracts WHERE id=$1 RETURNING id", [num(row.contractId), text(row.nodeName), Math.round(num(row.ratioPercent) * 100), cents(row.amountYuan), row.dueDate, text(row.isWarranty) === "true", user.id], "receivable_plans"); break;
      case "receipts": { const index = push("INSERT INTO receipts(company_id,project_id,receivable_plan_id,account_id,number,amount_cents,received_at,created_by) SELECT company_id,project_id,id,$2,$3,$4,$5,$6 FROM receivable_plans WHERE id=$1 RETURNING id", [num(row.receivablePlanId), num(row.accountId), text(row.number), cents(row.amountYuan), row.receivedAt, user.id], "receipts"); statements.push({ query: "UPDATE receivable_plans SET received_cents=received_cents+$1,status=CASE WHEN received_cents+$1>=amount_cents THEN '已收' ELSE '部分收款' END,updated_at=now(),updated_by=$2 WHERE id=$3", params: [cents(row.amountYuan), user.id, num(row.receivablePlanId)] }, { query: "UPDATE company_accounts SET balance_cents=balance_cents+$1,updated_at=now(),updated_by=$2 WHERE id=$3", params: [cents(row.amountYuan), user.id, num(row.accountId)] }); void index; break; }
      case "skus": push("INSERT INTO skus(company_id,project_id,code,room,category,name,brand,quantity,unit,budget_unit_cents,status,created_by) SELECT company_id,id,$2,$3,$4,$5,$6,$7,$8,$9,'待询价',$10 FROM projects WHERE id=$1 RETURNING id", [num(row.projectId), text(row.code), text(row.room), text(row.category), text(row.name), text(row.brand), num(row.quantity), text(row.unit), cents(row.budgetUnitYuan), user.id], "skus"); break;
      case "quotes": push("INSERT INTO supplier_quotes(company_id,project_id,sku_id,supplier_id,unit_price_cents,tax_rate_bps,freight_cents,install_cents,lead_days,payment_terms,status,created_by) SELECT company_id,project_id,id,$2,$3,$4,$5,$6,$7,$8,'待核价',$9 FROM skus WHERE id=$1 RETURNING id", [num(row.skuId), num(row.supplierId), cents(row.unitPriceYuan), Math.round(num(row.taxRatePercent) * 100), cents(row.freightYuan), cents(row.installYuan), num(row.leadDays), text(row.paymentTerms), user.id], "supplier_quotes"); break;
      case "purchase-requests": { const index = push("INSERT INTO purchase_requests(company_id,project_id,number,supplier_id,payment_type,amount_cents,requested_by,status,reason,created_by) SELECT company_id,id,$2,$3,$4,$5,$6,'待审批',$7,$6 FROM projects WHERE id=$1 RETURNING id", [num(row.projectId), text(row.number), num(row.supplierId), text(row.paymentType), cents(row.amountYuan), user.id, text(row.reason)], "purchase_requests"); statements.push({ query: "INSERT INTO purchase_request_items(request_id,sku_id,quantity,unit_price_cents,amount_cents,created_by) SELECT $1,id,quantity,round($3/NULLIF(quantity,0)),$3,$4 FROM skus WHERE id=$2", params: [{ fromResult: index, key: "id" }, num(row.skuId), cents(row.amountYuan), user.id] }); break; }
      case "payables": push("INSERT INTO payables(company_id,project_id,supplier_id,purchase_order_id,number,amount_cents,due_date,payment_node,invoice_status,status,created_by) SELECT company_id,project_id,supplier_id,id,$2,$3,$4,$5,$6,'待付',$7 FROM purchase_orders WHERE id=$1 RETURNING id", [num(row.purchaseOrderId), text(row.number), cents(row.amountYuan), row.dueDate, text(row.paymentNode), text(row.invoiceStatus), user.id], "payables"); break;
      case "payments": { push("INSERT INTO payments(company_id,project_id,payable_id,account_id,number,amount_cents,paid_at,method,created_by) SELECT company_id,project_id,id,$2,$3,$4,$5,$6,$7 FROM payables WHERE id=$1 RETURNING id", [num(row.payableId), num(row.accountId), text(row.number), cents(row.amountYuan), row.paidAt, text(row.method), user.id], "payments"); statements.push({ query: "UPDATE payables SET paid_cents=paid_cents+$1,status=CASE WHEN paid_cents+$1>=amount_cents THEN '已付' ELSE '部分付款' END,version=version+1,updated_at=now(),updated_by=$2 WHERE id=$3", params: [cents(row.amountYuan), user.id, num(row.payableId)] }, { query: "UPDATE company_accounts SET balance_cents=balance_cents-$1,updated_at=now(),updated_by=$2 WHERE id=$3", params: [cents(row.amountYuan), user.id, num(row.accountId)] }); break; }
      case "invoices": push("INSERT INTO invoices(company_id,project_id,customer_id,supplier_id,number,direction,type,amount_cents,issued_at,created_by) SELECT company_id,id,CASE WHEN $3='销项' THEN customer_id ELSE NULL END,CASE WHEN $3='进项' THEN $2 ELSE NULL END,$4,$3,$5,$6,$7,$8 FROM projects WHERE id=$1 RETURNING id", [num(row.projectId), row.supplierId ? num(row.supplierId) : null, text(row.direction), text(row.number), text(row.type), cents(row.amountYuan), row.issuedAt, user.id], "invoices"); break;
      default: throw new Error("该类型不支持原子导入");
    }
  }
  const logCompany: TransactionParam = companyId ?? firstCompanyResult ?? (() => { throw new Error("无法确定导入公司"); })();
  statements.push({ query: "INSERT INTO import_jobs(company_id,user_id,resource,filename,source_hash,total_rows,success_rows,error_rows,status,errors) VALUES($1,$2,$3,$4,$5,$6,$6,0,'已完成','[]'::jsonb)", params: [logCompany, user.id, resource, filename, sourceHash, rows.length] });
  await runTransaction(statements);
  return { successRows: rows.length, errorRows: 0, errors: [] as ImportError[] };
}
