import { runTransaction, sqlQuery, type TransactionStatement } from "@/db/client";
import { writeAudit } from "@/lib/audit";
import type { SessionUser } from "@/lib/auth";
import { assertCan } from "@/lib/permissions";

function projectScope(user: SessionUser, scope: number | null, alias = "s") {
  const params: unknown[] = []; const conditions: string[] = [];
  const companyId = user.role === "owner" ? scope : user.companyId;
  if (companyId) { params.push(companyId); conditions.push(`${alias}.company_id=$${params.length}`); }
  if (["project_manager", "designer"].includes(user.role)) { params.push(user.id); conditions.push(`EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id=${alias}.project_id AND pm.user_id=$${params.length})`); }
  return { clause: conditions.length ? conditions.join(" AND ") : "TRUE", params };
}

export async function getProcurementWorkspace(user: SessionUser, scope: number | null) {
  assertCan(user, "skus", "read"); const scoped = projectScope(user, scope);
  const rows = await sqlQuery<Record<string, unknown>>(`SELECT s.id,s.company_id AS "companyId",s.project_id AS "projectId",p.name AS "projectName",c.name AS "companyName",s.code,s.name,s.room,s.category,s.brand,s.model,s.specification,s.material,s.color,s.quantity,s.unit,s.budget_unit_cents AS "budgetUnitCents",s.image_url AS "legacyImageUrl",COALESCE((SELECT a.url FROM attachments a WHERE a.object_type='sku' AND a.object_id=s.id AND a.category='产品图片' AND NOT a.is_void ORDER BY a.created_at DESC LIMIT 1),s.image_url) AS "imageUrl",COALESCE((SELECT min(q.unit_price_cents) FROM supplier_quotes q WHERE q.sku_id=s.id),0)::float8 AS "lowestQuoteCents",selected.id AS "selectedQuoteId",selected.supplier_id AS "supplierId",sup.name AS "supplierName",selected.unit_price_cents AS "finalUnitCents",selected.freight_cents AS "freightCents",selected.install_cents AS "installCents",selected.lead_days AS "leadDays",COALESCE(
    (SELECT po.status FROM purchase_request_items pri JOIN purchase_requests pr ON pr.id=pri.request_id AND NOT pr.is_void AND pr.status<>'已驳回' JOIN purchase_orders po ON po.request_id=pr.id AND NOT po.is_void WHERE pri.sku_id=s.id ORDER BY po.ordered_at DESC LIMIT 1),
    (SELECT pr.status FROM purchase_request_items pri JOIN purchase_requests pr ON pr.id=pri.request_id AND NOT pr.is_void AND pr.status<>'已驳回' WHERE pri.sku_id=s.id ORDER BY pr.created_at DESC LIMIT 1),
    CASE WHEN selected.id IS NOT NULL THEN '已核价' WHEN EXISTS (SELECT 1 FROM supplier_quotes q WHERE q.sku_id=s.id) THEN '待核价' ELSE '待询价' END
  ) AS status FROM skus s JOIN projects p ON p.id=s.project_id JOIN companies c ON c.id=s.company_id LEFT JOIN supplier_quotes selected ON selected.id=(SELECT q.id FROM supplier_quotes q WHERE q.sku_id=s.id AND q.status='已选中' ORDER BY q.updated_at DESC LIMIT 1) LEFT JOIN suppliers sup ON sup.id=selected.supplier_id WHERE ${scoped.clause} ORDER BY p.name,s.room,s.category,s.id`, scoped.params);
  const skuIds = rows.map((row) => Number(row.id));
  const quotes = skuIds.length ? await sqlQuery<Record<string, unknown>>(`SELECT q.id,q.sku_id AS "skuId",q.supplier_id AS "supplierId",s.name AS "supplierName",q.unit_price_cents AS "unitPriceCents",q.freight_cents AS "freightCents",q.install_cents AS "installCents",q.tax_rate_bps AS "taxRateBps",q.lead_days AS "leadDays",q.payment_terms AS "paymentTerms",q.status,COALESCE((SELECT a.url FROM attachments a WHERE a.object_type='quote' AND a.object_id=q.id AND NOT a.is_void ORDER BY a.created_at DESC LIMIT 1),q.attachment_url) AS "attachmentUrl" FROM supplier_quotes q JOIN suppliers s ON s.id=q.supplier_id WHERE q.sku_id=ANY($1::int[]) ORDER BY q.sku_id,q.unit_price_cents`, [skuIds]) : [];
  const projects = Array.from(new Map(rows.map((row) => [Number(row.projectId), { id: Number(row.projectId), name: String(row.projectName), companyId: Number(row.companyId) }])).values());
  return { rows, quotes, projects };
}

export async function selectProcurementQuote(skuId: number, quoteId: number, user: SessionUser) {
  assertCan(user, "quotes", "write");
  const [quote] = await sqlQuery<{ id: number; skuId: number; supplierId: number; companyId: number; projectId: number; unitPriceCents: number; freightCents: number; installCents: number; taxRateBps: number; leadDays: number; skuStatus: string }>(`SELECT q.id,q.sku_id AS "skuId",q.supplier_id AS "supplierId",q.company_id AS "companyId",q.project_id AS "projectId",q.unit_price_cents AS "unitPriceCents",q.freight_cents AS "freightCents",q.install_cents AS "installCents",q.tax_rate_bps AS "taxRateBps",q.lead_days AS "leadDays",s.status AS "skuStatus" FROM supplier_quotes q JOIN skus s ON s.id=q.sku_id WHERE q.id=$1 AND q.sku_id=$2`, [quoteId, skuId]);
  if (!quote) throw new Error("报价与 SKU 不匹配"); if (user.companyId !== null && quote.companyId !== user.companyId) throw new Error("FORBIDDEN"); if (["已下单", "部分到货", "已到货"].includes(quote.skuStatus)) throw new Error("已下单 SKU 不能重新选供");
  await runTransaction([
    { query: `UPDATE supplier_quotes SET status='未选中',updated_at=now(),updated_by=$1 WHERE sku_id=$2`, params: [user.id, skuId] },
    { query: `UPDATE supplier_quotes SET status='已选中',updated_at=now(),updated_by=$1 WHERE id=$2`, params: [user.id, quoteId] },
    { query: `UPDATE skus SET supplier_id=$1,final_unit_cents=$2,freight_cents=$3,install_cents=$4,tax_rate_bps=$5,lead_days=$6,status='已核价',updated_at=now(),updated_by=$7 WHERE id=$8`, params: [quote.supplierId, quote.unitPriceCents, quote.freightCents, quote.installCents, quote.taxRateBps, quote.leadDays, user.id, skuId] },
  ]);
  await writeAudit({ user, companyId: quote.companyId, projectId: quote.projectId, objectType: "sku", objectId: skuId, action: "SELECT_SUPPLIER", after: { quoteId, supplierId: quote.supplierId, unitPriceCents: quote.unitPriceCents } });
}

export async function createWorkspacePurchaseRequest(input: { skuIds: number[]; paymentType: string; reason: string }, user: SessionUser) {
  assertCan(user, "purchase-requests", "write"); const skuIds = [...new Set(input.skuIds.filter(Number.isInteger))];
  if (!skuIds.length) throw new Error("请至少选择一个 SKU"); if (!input.reason.trim()) throw new Error("请填写采购说明"); if (!["对公", "批量私账"].includes(input.paymentType)) throw new Error("付款方式无效");
  const items = await sqlQuery<{ id: number; companyId: number; projectId: number; quantity: number; supplierId: number | null; quoteId: number | null; unitPriceCents: number | null; freightCents: number; installCents: number; status: string }>(`SELECT s.id,s.company_id AS "companyId",s.project_id AS "projectId",s.quantity,q.supplier_id AS "supplierId",q.id AS "quoteId",q.unit_price_cents AS "unitPriceCents",q.freight_cents AS "freightCents",q.install_cents AS "installCents",COALESCE((SELECT pr.status FROM purchase_request_items pri JOIN purchase_requests pr ON pr.id=pri.request_id AND NOT pr.is_void AND pr.status<>'已驳回' WHERE pri.sku_id=s.id ORDER BY pr.created_at DESC LIMIT 1),CASE WHEN q.id IS NULL THEN s.status ELSE '已核价' END) AS status FROM skus s LEFT JOIN supplier_quotes q ON q.id=(SELECT sq.id FROM supplier_quotes sq WHERE sq.sku_id=s.id AND sq.status='已选中' ORDER BY sq.updated_at DESC LIMIT 1) WHERE s.id=ANY($1::int[])`, [skuIds]);
  if (items.length !== skuIds.length) throw new Error("部分 SKU 不存在");
  const first = items[0]; if (user.companyId !== null && first.companyId !== user.companyId) throw new Error("FORBIDDEN");
  if (items.some((item) => item.companyId !== first.companyId || item.projectId !== first.projectId || item.supplierId !== first.supplierId)) throw new Error("批量采购必须是同公司、同项目、同供应商，请拆分后提交");
  if (!first.supplierId || items.some((item) => !item.quoteId || !item.unitPriceCents)) throw new Error("所选 SKU 必须先完成选供核价");
  if (items.some((item) => ["待审批", "已通过", "已下单", "部分到货", "已到货"].includes(item.status))) throw new Error("所选 SKU 中包含已提交或已下单项目");
  const amounts = items.map((item) => Math.round(Number(item.unitPriceCents) * Number(item.quantity) + Number(item.freightCents) + Number(item.installCents))); const total = amounts.reduce((sum, amount) => sum + amount, 0); const number = `CGSQ-${Date.now()}`;
  const statements: TransactionStatement[] = [{ query: `INSERT INTO purchase_requests(company_id,project_id,number,supplier_id,payment_type,amount_cents,requested_by,status,reason,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,'待审批',$8,$7) RETURNING id,number`, params: [first.companyId, first.projectId, number, first.supplierId, input.paymentType, total, user.id, input.reason.trim()] }];
  items.forEach((item, index) => statements.push({ query: `INSERT INTO purchase_request_items(request_id,sku_id,quote_id,quantity,unit_price_cents,amount_cents,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)`, params: [{ fromResult: 0, key: "id" }, item.id, item.quoteId, item.quantity, item.unitPriceCents, amounts[index], user.id] }));
  statements.push({ query: `UPDATE skus SET status='待审批',updated_at=now(),updated_by=$1 WHERE id=ANY($2::int[])`, params: [user.id, skuIds] });
  const result = await runTransaction<{ id: number; number: string }>(statements); const request = result[0][0];
  await writeAudit({ user, companyId: first.companyId, projectId: first.projectId, objectType: "purchase_request", objectId: request.id, action: "SUBMIT", after: { number, skuIds, supplierId: first.supplierId, amountCents: total } });
  return { ...request, amountCents: total };
}
