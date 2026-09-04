import { sqlQuery } from "@/db/client";
import type { SessionUser } from "@/lib/auth";

export type AiAnswer = {
  title: string;
  conclusion: string;
  totalCents?: number;
  items: { name: string; detail: string; amountCents: number; status?: string }[];
  basis: string;
  action: string;
};

const supportedLegacyPatterns = ["逾期", "未付款", "超预算", "采购预算", "欠票", "发票", "要收", "应收", "要付", "应付", "待付款", "资金缺口", "现金"];

export function canLegacyHandle(question: string) {
  const normalized = question.replaceAll(" ", "");
  return supportedLegacyPatterns.some((pattern) => normalized.includes(pattern));
}

function projectScope(user: SessionUser, companyScope: number | null, alias = "p") {
  const params: unknown[] = []; const conditions: string[] = [];
  if (companyScope !== null) { params.push(companyScope); conditions.push(`${alias}.company_id=$${params.length}`); }
  if (user.role === "project_manager" || user.role === "designer") { params.push(user.id); conditions.push(`EXISTS (SELECT 1 FROM project_members pm_ai WHERE pm_ai.project_id=${alias}.id AND pm_ai.user_id=$${params.length})`); }
  return { sql: conditions.length ? conditions.join(" AND ") : "TRUE", params };
}

export async function answerFinancialQuestion(question: string, user: SessionUser, companyScope: number | null): Promise<AiAnswer> {
  const scope = projectScope(user, companyScope);
  const q = question.replaceAll(" ", "");
  if (user.role === "designer" && !q.includes("采购") && !q.includes("预算")) {
    return { title: "权限范围说明", conclusion: "设计师账号仅可查询参与项目的 SKU、采购与预算信息。", items: [], basis: "当前登录角色：设计师", action: "如需查看资金、应收或应付，请联系财务或老板。" };
  }
  if (q.includes("逾期") || q.includes("客户") && q.includes("未付款")) {
    const rows = await sqlQuery<{ projectName: string; customerName: string; nodeName: string; amountCents: number; days: number }>(`SELECT p.name AS "projectName",c.name AS "customerName",rp.node_name AS "nodeName",(rp.amount_cents-rp.received_cents)::float8 AS "amountCents",floor(extract(epoch from (now()-rp.due_date))/86400)::int AS days FROM receivable_plans rp JOIN projects p ON p.id=rp.project_id JOIN customers c ON c.id=p.customer_id WHERE ${scope.sql} AND NOT rp.is_void AND NOT rp.is_warranty AND rp.due_date<now() AND rp.received_cents<rp.amount_cents ORDER BY "amountCents" DESC`, scope.params);
    const total = rows.reduce((sum, row) => sum + row.amountCents, 0);
    return { title: "逾期客户应收", conclusion: rows.length ? `当前有 ${rows.length} 个逾期收款节点，合计待收。` : "当前没有普通应收逾期。", totalCents: total, items: rows.slice(0, 8).map((row) => ({ name: row.customerName, detail: `${row.projectName} · ${row.nodeName} · 逾期 ${row.days} 天`, amountCents: row.amountCents, status: "已逾期" })), basis: "应收节点预计日期早于今天、未作废、未收清，并排除未释放质保金。", action: rows.length ? "先联系金额最大的三位客户确认付款日期，并在收款计划中更新争议或暂缓状态。" : "继续按未来 30 天应收计划跟进。" };
  }
  if (q.includes("超预算") || q.includes("采购") && q.includes("预算")) {
    const rows = await sqlQuery<{ projectName: string; code: string; budgetCents: number; orderedCents: number; amountCents: number }>(`SELECT p.name AS "projectName",p.code,p.budget_cents AS "budgetCents",COALESCE(sum(po.amount_cents),0)::float8 AS "orderedCents",(COALESCE(sum(po.amount_cents),0)-p.budget_cents)::float8 AS "amountCents" FROM projects p LEFT JOIN purchase_orders po ON po.project_id=p.id AND NOT po.is_void WHERE ${scope.sql} GROUP BY p.id,p.name,p.code,p.budget_cents HAVING COALESCE(sum(po.amount_cents),0)>p.budget_cents ORDER BY "amountCents" DESC`, scope.params);
    return { title: "采购超预算项目", conclusion: rows.length ? `${rows.length} 个项目的已下单成本超过当前采购预算。` : "当前没有项目采购超预算。", totalCents: rows.reduce((sum, row) => sum + row.amountCents, 0), items: rows.map((row) => ({ name: row.projectName, detail: `${row.code} · 预算 ${Math.round(row.budgetCents / 100).toLocaleString()} 元`, amountCents: row.amountCents, status: "超预算" })), basis: "当前有效采购订单金额合计与项目当前预算比较。", action: rows.length ? "暂停新增采购，核对是否存在未登记的预算变更，并由项目经理提交变更审批。" : "继续关注采购核价与预算占用比例。" };
  }
  if (q.includes("欠票") || q.includes("发票")) {
    const rows = await sqlQuery<{ supplierName: string; projectName: string; amountCents: number }>(`SELECT s.name AS "supplierName",p.name AS "projectName",sum(y.amount_cents)::float8 AS "amountCents" FROM payables y JOIN suppliers s ON s.id=y.supplier_id JOIN projects p ON p.id=y.project_id WHERE ${scope.sql} AND NOT y.is_void AND y.invoice_status='欠票' GROUP BY s.id,s.name,p.id,p.name ORDER BY "amountCents" DESC`, scope.params);
    return { title: "供应商欠票", conclusion: rows.length ? `${rows.length} 组项目供应商存在欠票。` : "当前没有供应商欠票。", totalCents: rows.reduce((sum, row) => sum + row.amountCents, 0), items: rows.slice(0, 8).map((row) => ({ name: row.supplierName, detail: row.projectName, amountCents: row.amountCents, status: "欠票" })), basis: "有效应付记录中发票状态为“欠票”的应付金额。", action: "按金额从高到低向供应商催票，收到后在发票台账登记并核销欠票状态。" };
  }
  const days = q.includes("7天") ? 7 : 30;
  if (q.includes("要收") || q.includes("应收")) {
    const rows = await sqlQuery<{ projectName: string; customerName: string; nodeName: string; dueDate: string; amountCents: number }>(`SELECT p.name AS "projectName",c.name AS "customerName",rp.node_name AS "nodeName",rp.due_date::text AS "dueDate",(rp.amount_cents-rp.received_cents)::float8 AS "amountCents" FROM receivable_plans rp JOIN projects p ON p.id=rp.project_id JOIN customers c ON c.id=p.customer_id WHERE ${scope.sql} AND NOT rp.is_void AND NOT rp.is_warranty AND rp.received_cents<rp.amount_cents AND rp.due_date BETWEEN now() AND now()+($${scope.params.length + 1}||' day')::interval ORDER BY rp.due_date`, [...scope.params, days]);
    return { title: `未来 ${days} 天应收`, conclusion: rows.length ? `未来 ${days} 天预计有 ${rows.length} 个收款节点。` : `未来 ${days} 天没有到期应收。`, totalCents: rows.reduce((sum, row) => sum + row.amountCents, 0), items: rows.slice(0, 8).map((row) => ({ name: row.customerName, detail: `${row.projectName} · ${row.nodeName} · ${row.dueDate.slice(0, 10)}`, amountCents: row.amountCents })), basis: `未作废、未收清、非质保金且预计日期位于未来 ${days} 天的应收节点。`, action: "提前 3 个工作日向客户确认付款流程和所需票据。" };
  }
  if (q.includes("要付") || q.includes("应付") || q.includes("待付款")) {
    const rows = await sqlQuery<{ supplierName: string; projectName: string; dueDate: string; amountCents: number; status: string }>(`SELECT s.name AS "supplierName",p.name AS "projectName",y.due_date::text AS "dueDate",(y.amount_cents-y.paid_cents)::float8 AS "amountCents",y.status FROM payables y JOIN projects p ON p.id=y.project_id JOIN suppliers s ON s.id=y.supplier_id WHERE ${scope.sql} AND NOT y.is_void AND y.paid_cents<y.amount_cents AND y.due_date<=now()+($${scope.params.length + 1}||' day')::interval ORDER BY y.due_date`, [...scope.params, days]);
    return { title: `未来 ${days} 天应付`, conclusion: rows.length ? `${rows.length} 笔应付需要安排资金。` : `未来 ${days} 天没有到期应付。`, totalCents: rows.reduce((sum, row) => sum + row.amountCents, 0), items: rows.slice(0, 8).map((row) => ({ name: row.supplierName, detail: `${row.projectName} · ${row.dueDate.slice(0, 10)}`, amountCents: row.amountCents, status: row.status })), basis: `有效且未付清、到期日在未来 ${days} 天内（含已逾期）的供应商应付。`, action: "先核对到货与发票，再按到期日提交付款申请。" };
  }
  if (q.includes("资金缺口") || q.includes("现金")) {
    const [row] = await sqlQuery<{ balanceCents: number; receivableCents: number; payableCents: number }>(`SELECT (SELECT COALESCE(sum(a.balance_cents),0)::float8 FROM company_accounts a ${companyScope === null ? "" : "WHERE a.company_id=$1"}) AS "balanceCents",(SELECT COALESCE(sum(rp.amount_cents-rp.received_cents),0)::float8 FROM receivable_plans rp JOIN projects p ON p.id=rp.project_id WHERE ${scope.sql} AND NOT rp.is_void AND NOT rp.is_warranty AND rp.due_date BETWEEN now() AND now()+interval '30 day') AS "receivableCents",(SELECT COALESCE(sum(y.amount_cents-y.paid_cents),0)::float8 FROM payables y JOIN projects p ON p.id=y.project_id WHERE ${scope.sql} AND NOT y.is_void AND y.due_date BETWEEN now() AND now()+interval '30 day') AS "payableCents"`, scope.params);
    const closing = row.balanceCents + row.receivableCents - row.payableCents;
    return { title: "未来 30 天资金缺口", conclusion: closing < 0 ? "按当前确定性收支，公司存在预计资金缺口。" : "按当前确定性收支，公司暂不存在资金缺口。", totalCents: Math.abs(closing), items: [{ name: "当前资金余额", detail: "公司账户手工维护余额", amountCents: row.balanceCents }, { name: "未来 30 天应收", detail: "未计质保金", amountCents: row.receivableCents }, { name: "未来 30 天应付", detail: "尚未付清", amountCents: -row.payableCents }], basis: "预计期末资金 = 当前账户余额 + 30 天应收 - 30 天应付，不含未确定的新业务和税费。", action: closing < 0 ? "立即推进最近应收，并与供应商协商非关键付款节点。" : "保留付款安全垫，关注逾期应收是否按期到账。" };
  }
  return { title: "可查询的经营问题", conclusion: "我只基于系统中的结构化业务数据回答，不会修改任何财务记录。", items: [], basis: "支持应收、应付、超预算、欠票和 30 天资金缺口。", action: "可直接点击左侧常用问题，或输入“未来 7 天要付多少钱”。" };
}
