import { sqlQuery } from "@/db/client";
import type { SessionUser } from "@/lib/auth";
import { assertCan, type ResourceKey } from "@/lib/permissions";

export type ColumnDef = {
  key: string;
  label: string;
  format?: "money" | "date" | "status" | "ratio" | "number";
  align?: "left" | "right";
};

export type FieldDef = {
  key: string;
  label: string;
  type: "text" | "number" | "date" | "select" | "textarea" | "reference";
  required?: boolean;
  options?: { value: string; label: string }[];
  reference?: "companies" | "customers" | "suppliers" | "projects" | "contracts" | "receivables" | "accounts" | "skus" | "payables" | "purchase-orders";
  placeholder?: string;
};

export type ResourceDefinition = {
  key: ResourceKey;
  title: string;
  eyebrow: string;
  description: string;
  searchPlaceholder: string;
  columns: ColumnDef[];
  fields?: FieldDef[];
  createLabel?: string;
  query: string;
  alias: string;
  projectExpression?: string;
  emptyTitle: string;
};

export const definitions: Partial<Record<ResourceKey, ResourceDefinition>> = {
  projects: {
    key: "projects", title: "项目", eyebrow: "经营核心", description: "以项目为中心汇总合同、采购、收付款、票据和风险。", searchPlaceholder: "搜索项目名称、编号或客户",
    columns: [{ key: "code", label: "项目编号" }, { key: "name", label: "项目名称" }, { key: "companyName", label: "所属公司" }, { key: "customerName", label: "客户" }, { key: "managerName", label: "项目经理" }, { key: "contractCents", label: "当前合同", format: "money", align: "right" }, { key: "orderedCents", label: "已下单", format: "money", align: "right" }, { key: "receivedCents", label: "已收款", format: "money", align: "right" }, { key: "risk", label: "风险", format: "status" }, { key: "status", label: "状态", format: "status" }],
    fields: [{ key: "companyId", label: "所属公司", type: "reference", reference: "companies", required: true }, { key: "customerId", label: "客户", type: "reference", reference: "customers", required: true }, { key: "code", label: "项目编号", type: "text", required: true }, { key: "name", label: "项目名称", type: "text", required: true }, { key: "address", label: "项目地址", type: "text" }, { key: "contractYuan", label: "原始合同金额（元）", type: "number", required: true }, { key: "budgetYuan", label: "采购预算（元）", type: "number", required: true }, { key: "startDate", label: "开始日期", type: "date", required: true }, { key: "expectedEndDate", label: "预计完成日期", type: "date", required: true }],
    query: `SELECT p.id,p.company_id AS "companyId",p.customer_id AS "customerId",p.code,p.name,p.address,c.name AS "companyName",cu.name AS "customerName",u.name AS "managerName",p.original_contract_cents AS "originalContractCents",p.current_contract_cents AS "contractCents",p.budget_cents AS "budgetCents",p.start_date::text AS "startDate",p.expected_end_date::text AS "expectedEndDate",COALESCE((SELECT sum(po.amount_cents) FROM purchase_orders po WHERE po.project_id=p.id AND NOT po.is_void),0)::float8 AS "orderedCents",COALESCE((SELECT sum(r.amount_cents) FROM receipts r WHERE r.project_id=p.id AND NOT r.is_void),0)::float8 AS "receivedCents",CASE WHEN COALESCE((SELECT sum(po.amount_cents) FROM purchase_orders po WHERE po.project_id=p.id AND NOT po.is_void),0)>p.budget_cents THEN '超预算' WHEN COALESCE((SELECT sum(rp.amount_cents-rp.received_cents) FROM receivable_plans rp WHERE rp.project_id=p.id AND rp.due_date<now() AND NOT rp.is_void AND NOT rp.is_warranty),0)>0 THEN '回款逾期' ELSE '正常' END AS risk,p.status FROM projects p JOIN companies c ON c.id=p.company_id JOIN customers cu ON cu.id=p.customer_id LEFT JOIN users u ON u.id=p.manager_id WHERE {scope} ORDER BY p.updated_at DESC`, alias: "p", projectExpression: "p.id", emptyTitle: "暂无项目",
  },
  companies: {
    key: "companies", title: "公司管理", eyebrow: "组织与核算", description: "集团内独立核算主体及当前状态。", searchPlaceholder: "搜索公司名称或编码",
    columns: [{ key: "code", label: "公司编码" }, { key: "name", label: "公司名称" }, { key: "legalRepresentative", label: "法定代表人" }, { key: "accountCount", label: "账户数", format: "number", align: "right" }, { key: "balanceCents", label: "资金余额", format: "money", align: "right" }, { key: "status", label: "状态", format: "status" }],
    fields: [{ key: "code", label: "公司编码", type: "text", required: true }, { key: "name", label: "公司名称", type: "text", required: true }, { key: "legalRepresentative", label: "法定代表人", type: "text", required: true }],
    query: `SELECT c.id,c.code,c.name,c.legal_representative AS "legalRepresentative",c.status,count(a.id)::int AS "accountCount",COALESCE(sum(a.balance_cents),0)::float8 AS "balanceCents" FROM companies c LEFT JOIN company_accounts a ON a.company_id=c.id WHERE {scope} GROUP BY c.id ORDER BY c.id`, alias: "c", emptyTitle: "暂无公司",
  },
  accounts: {
    key: "accounts", title: "账户管理", eyebrow: "资金", description: "手工维护公司账户余额，法人往来与对公账户分开呈现。", searchPlaceholder: "搜索账户、银行或公司",
    columns: [{ key: "companyName", label: "公司" }, { key: "name", label: "账户名称" }, { key: "type", label: "账户类型", format: "status" }, { key: "bank", label: "开户行" }, { key: "lastFour", label: "尾号" }, { key: "balanceCents", label: "当前余额", format: "money", align: "right" }, { key: "updatedAt", label: "更新时间", format: "date" }],
    fields: [{ key: "companyId", label: "所属公司", type: "reference", reference: "companies", required: true }, { key: "name", label: "账户名称", type: "text", required: true }, { key: "type", label: "账户类型", type: "select", required: true, options: ["对公账户", "现金", "微信", "支付宝", "法人代垫", "股东借款", "其他"].map((value) => ({ value, label: value })) }, { key: "bank", label: "开户行", type: "text" }, { key: "lastFour", label: "卡号尾号", type: "text" }, { key: "balanceYuan", label: "当前余额（元）", type: "number", required: true }],
    query: `SELECT a.id,a.company_id AS "companyId",c.name AS "companyName",a.name,a.type,a.bank,a.last_four AS "lastFour",a.balance_cents AS "balanceCents",a.status,a.updated_at::text AS "updatedAt" FROM company_accounts a JOIN companies c ON c.id=a.company_id WHERE {scope} ORDER BY a.balance_cents DESC`, alias: "a", emptyTitle: "暂无账户",
  },
  users: {
    key: "users", title: "用户与角色", eyebrow: "组织与权限", description: "用户角色决定功能权限，公司与项目范围决定数据边界。", searchPlaceholder: "搜索姓名、邮箱或角色",
    columns: [{ key: "name", label: "姓名" }, { key: "email", label: "登录邮箱" }, { key: "roleLabel", label: "角色", format: "status" }, { key: "companyName", label: "数据公司" }, { key: "status", label: "状态", format: "status" }, { key: "createdAt", label: "创建时间", format: "date" }],
    fields: [{ key: "companyId", label: "所属公司", type: "reference", reference: "companies" }, { key: "name", label: "姓名", type: "text", required: true }, { key: "email", label: "邮箱", type: "text", required: true }, { key: "role", label: "角色", type: "select", required: true, options: [{ value: "finance", label: "财务" }, { value: "procurement", label: "采购" }, { value: "project_manager", label: "项目经理" }, { value: "designer", label: "设计师" }] }, { key: "password", label: "初始密码", type: "text", required: true }],
    query: `SELECT u.id,u.company_id AS "companyId",u.name,u.email,CASE u.role WHEN 'owner' THEN '老板' WHEN 'finance' THEN '财务' WHEN 'procurement' THEN '采购' WHEN 'project_manager' THEN '项目经理' ELSE '设计师' END AS "roleLabel",COALESCE(c.name,'集团全部') AS "companyName",u.status,u.created_at::text AS "createdAt" FROM users u LEFT JOIN companies c ON c.id=u.company_id WHERE {scope} ORDER BY u.id`, alias: "u", emptyTitle: "暂无用户",
  },
  customers: {
    key: "customers", title: "客户", eyebrow: "往来单位", description: "客户档案与项目、合同及应收保持一致关联。", searchPlaceholder: "搜索客户、编码或联系人",
    columns: [{ key: "code", label: "客户编码" }, { key: "name", label: "客户名称" }, { key: "type", label: "客户类型", format: "status" }, { key: "contact", label: "联系人" }, { key: "phone", label: "联系电话" }, { key: "projectCount", label: "关联项目", format: "number", align: "right" }, { key: "contractCents", label: "合同金额", format: "money", align: "right" }],
    fields: [{ key: "companyId", label: "所属公司", type: "reference", reference: "companies", required: true }, { key: "code", label: "客户编码", type: "text", required: true }, { key: "name", label: "客户名称", type: "text", required: true }, { key: "type", label: "客户类型", type: "select", required: true, options: ["地产公司", "酒店", "设计公司", "商业客户", "其他"].map((value) => ({ value, label: value })) }, { key: "contact", label: "联系人", type: "text" }, { key: "phone", label: "联系电话", type: "text" }],
    query: `SELECT cu.id,cu.company_id AS "companyId",cu.code,cu.name,cu.type,cu.contact,cu.phone,count(p.id)::int AS "projectCount",COALESCE(sum(p.current_contract_cents),0)::float8 AS "contractCents" FROM customers cu LEFT JOIN projects p ON p.customer_id=cu.id WHERE {scope} GROUP BY cu.id ORDER BY cu.id DESC`, alias: "cu", projectExpression: "p.id", emptyTitle: "暂无客户",
  },
  suppliers: {
    key: "suppliers", title: "供应商", eyebrow: "采购资源", description: "供应商采购、付款和欠票情况集中查看。", searchPlaceholder: "搜索供应商、品类或联系人",
    columns: [{ key: "code", label: "供应商编码" }, { key: "name", label: "供应商名称" }, { key: "category", label: "主营品类", format: "status" }, { key: "contact", label: "联系人" }, { key: "orderedCents", label: "采购金额", format: "money", align: "right" }, { key: "unpaidCents", label: "待付款", format: "money", align: "right" }, { key: "missingInvoiceCents", label: "欠票金额", format: "money", align: "right" }],
    fields: [{ key: "companyId", label: "所属公司", type: "reference", reference: "companies", required: true }, { key: "code", label: "供应商编码", type: "text", required: true }, { key: "name", label: "供应商名称", type: "text", required: true }, { key: "category", label: "主营品类", type: "text", required: true }, { key: "contact", label: "联系人", type: "text" }, { key: "phone", label: "联系电话", type: "text" }, { key: "taxNumber", label: "税号", type: "text" }],
    query: `SELECT s.id,s.company_id AS "companyId",s.code,s.name,s.category,s.contact,s.phone,s.tax_number AS "taxNumber",COALESCE(sum(DISTINCT po.amount_cents),0)::float8 AS "orderedCents",COALESCE(sum(DISTINCT y.amount_cents-y.paid_cents),0)::float8 AS "unpaidCents",COALESCE(sum(DISTINCT CASE WHEN y.invoice_status='欠票' THEN y.amount_cents ELSE 0 END),0)::float8 AS "missingInvoiceCents" FROM suppliers s LEFT JOIN purchase_orders po ON po.supplier_id=s.id AND NOT po.is_void LEFT JOIN payables y ON y.supplier_id=s.id AND NOT y.is_void WHERE {scope} GROUP BY s.id ORDER BY "orderedCents" DESC`, alias: "s", emptyTitle: "暂无供应商",
  },
  contracts: {
    key: "contracts", title: "合同", eyebrow: "经营收入", description: "合同金额作为经营确认收入，并通过应收节点管理回款。", searchPlaceholder: "搜索合同编号、名称或项目",
    columns: [{ key: "number", label: "合同编号" }, { key: "projectName", label: "项目" }, { key: "customerName", label: "客户" }, { key: "amountCents", label: "合同金额", format: "money", align: "right" }, { key: "receivedCents", label: "已收款", format: "money", align: "right" }, { key: "signedAt", label: "签约日期", format: "date" }, { key: "status", label: "状态", format: "status" }],
    fields: [{ key: "projectId", label: "所属项目", type: "reference", reference: "projects", required: true }, { key: "number", label: "合同编号", type: "text", required: true }, { key: "name", label: "合同名称", type: "text", required: true }, { key: "amountYuan", label: "合同金额（元）", type: "number", required: true }, { key: "signedAt", label: "签约日期", type: "date" }, { key: "attachmentUrl", label: "合同附件 URL", type: "text" }, { key: "status", label: "合同状态", type: "select", required: true, options: [{ value: "草稿", label: "草稿" }, { value: "生效中", label: "直接生效" }] }],
    query: `SELECT ct.id,ct.company_id AS "companyId",ct.project_id AS "projectId",ct.number,ct.name,p.name AS "projectName",cu.name AS "customerName",ct.amount_cents AS "amountCents",COALESCE(sum(r.received_cents),0)::float8 AS "receivedCents",ct.signed_at::text AS "signedAt",ct.attachment_url AS "attachmentUrl",ct.status FROM contracts ct JOIN projects p ON p.id=ct.project_id JOIN customers cu ON cu.id=p.customer_id LEFT JOIN receivable_plans r ON r.contract_id=ct.id AND NOT r.is_void WHERE {scope} AND NOT ct.is_void GROUP BY ct.id,p.name,cu.name ORDER BY ct.signed_at DESC`, alias: "ct", projectExpression: "ct.project_id", emptyTitle: "暂无合同",
  },
  receivables: {
    key: "receivables", title: "应收计划", eyebrow: "客户回款", description: "自定义合同收款节点，质保金到期前不计入普通逾期。", searchPlaceholder: "搜索项目、客户或节点",
    columns: [{ key: "projectName", label: "项目" }, { key: "nodeName", label: "收款节点" }, { key: "ratioBps", label: "比例", format: "ratio", align: "right" }, { key: "amountCents", label: "应收金额", format: "money", align: "right" }, { key: "receivedCents", label: "已收金额", format: "money", align: "right" }, { key: "remainingCents", label: "未收金额", format: "money", align: "right" }, { key: "dueDate", label: "预计日期", format: "date" }, { key: "status", label: "状态", format: "status" }],
    fields: [{ key: "contractId", label: "合同", type: "reference", reference: "contracts", required: true }, { key: "nodeName", label: "节点名称", type: "text", required: true }, { key: "ratioPercent", label: "比例（%）", type: "number", required: true }, { key: "amountYuan", label: "应收金额（元）", type: "number", required: true }, { key: "dueDate", label: "预计收款日期", type: "date", required: true }, { key: "isWarranty", label: "节点类型", type: "select", required: true, options: [{ value: "false", label: "普通应收" }, { value: "true", label: "质保金" }] }],
    query: `SELECT rp.id,rp.company_id AS "companyId",rp.project_id AS "projectId",rp.contract_id AS "contractId",p.name AS "projectName",cu.name AS "customerName",rp.node_name AS "nodeName",rp.ratio_bps AS "ratioBps",rp.amount_cents AS "amountCents",rp.received_cents AS "receivedCents",rp.is_warranty AS "isWarranty",(rp.amount_cents-rp.received_cents)::float8 AS "remainingCents",rp.due_date::text AS "dueDate",CASE WHEN rp.is_warranty AND rp.due_date>now() THEN '待释放质保金' WHEN rp.received_cents>=rp.amount_cents THEN '已收' WHEN rp.due_date<now() THEN '已逾期' ELSE rp.status END AS status FROM receivable_plans rp JOIN projects p ON p.id=rp.project_id JOIN customers cu ON cu.id=p.customer_id WHERE {scope} AND NOT rp.is_void ORDER BY rp.due_date`, alias: "rp", projectExpression: "rp.project_id", emptyTitle: "暂无应收节点",
  },
  receipts: {
    key: "receipts", title: "收款记录", eyebrow: "客户回款", description: "登记到账结果后自动更新应收余额与账户资金。", searchPlaceholder: "搜索收款编号、项目或客户",
    columns: [{ key: "number", label: "收款编号" }, { key: "projectName", label: "项目" }, { key: "customerName", label: "客户" }, { key: "nodeName", label: "收款节点" }, { key: "amountCents", label: "收款金额", format: "money", align: "right" }, { key: "accountName", label: "收款账户" }, { key: "receiptEvidence", label: "银行回单", format: "status" }, { key: "receivedAt", label: "到账日期", format: "date" }, { key: "status", label: "状态", format: "status" }],
    fields: [{ key: "receivablePlanId", label: "应收节点", type: "reference", reference: "receivables", required: true }, { key: "accountId", label: "收款账户", type: "reference", reference: "accounts", required: true }, { key: "number", label: "收款编号", type: "text", required: true }, { key: "amountYuan", label: "收款金额（元）", type: "number", required: true }, { key: "receivedAt", label: "到账日期", type: "date", required: true }, { key: "bankReceiptUrl", label: "银行回单 URL", type: "text" }],
    query: `SELECT r.id,r.company_id AS "companyId",r.project_id AS "projectId",r.number,p.name AS "projectName",cu.name AS "customerName",rp.node_name AS "nodeName",r.amount_cents AS "amountCents",a.name AS "accountName",CASE WHEN r.bank_receipt_url IS NULL THEN '未上传' ELSE '已上传' END AS "receiptEvidence",r.bank_receipt_url AS "bankReceiptUrl",r.received_at::text AS "receivedAt",r.status FROM receipts r JOIN projects p ON p.id=r.project_id JOIN customers cu ON cu.id=p.customer_id JOIN receivable_plans rp ON rp.id=r.receivable_plan_id LEFT JOIN company_accounts a ON a.id=r.account_id WHERE {scope} AND NOT r.is_void ORDER BY r.received_at DESC`, alias: "r", projectExpression: "r.project_id", emptyTitle: "暂无收款记录",
  },
  skus: {
    key: "skus", title: "SKU 明细", eyebrow: "选品与采购", description: "从房间、品类到最终供应商的项目级采购底表。", searchPlaceholder: "搜索 SKU、产品、品牌或项目",
    columns: [{ key: "code", label: "SKU 编码" }, { key: "projectName", label: "项目" }, { key: "room", label: "区域" }, { key: "category", label: "品类", format: "status" }, { key: "name", label: "产品" }, { key: "quantity", label: "数量", format: "number", align: "right" }, { key: "budgetTotalCents", label: "预算采购", format: "money", align: "right" }, { key: "finalTotalCents", label: "最终采购", format: "money", align: "right" }, { key: "status", label: "状态", format: "status" }],
    fields: [{ key: "projectId", label: "所属项目", type: "reference", reference: "projects", required: true }, { key: "code", label: "SKU 编码", type: "text", required: true }, { key: "room", label: "房间 / 区域", type: "text", required: true }, { key: "category", label: "品类", type: "text", required: true }, { key: "name", label: "产品名称", type: "text", required: true }, { key: "brand", label: "品牌", type: "text" }, { key: "quantity", label: "数量", type: "number", required: true }, { key: "unit", label: "单位", type: "text", required: true }, { key: "budgetUnitYuan", label: "预算单价（元）", type: "number", required: true }, { key: "imageUrl", label: "产品图片 URL", type: "text" }],
    query: `SELECT s.id,s.company_id AS "companyId",s.project_id AS "projectId",s.code,p.name AS "projectName",s.room,s.category,s.name,s.brand,s.quantity,s.unit,s.budget_unit_cents AS "budgetUnitCents",s.image_url AS "imageUrl",(s.quantity*s.budget_unit_cents)::float8 AS "budgetTotalCents",(s.quantity*COALESCE(s.final_unit_cents,0)+s.freight_cents+s.install_cents)::float8 AS "finalTotalCents",sup.name AS "supplierName",s.status FROM skus s JOIN projects p ON p.id=s.project_id LEFT JOIN suppliers sup ON sup.id=s.supplier_id WHERE {scope} ORDER BY s.id DESC`, alias: "s", projectExpression: "s.project_id", emptyTitle: "暂无 SKU",
  },
  quotes: {
    key: "quotes", title: "供应商报价", eyebrow: "比价核价", description: "同一 SKU 的多供应商报价、税费、交期和付款条件对比。", searchPlaceholder: "搜索 SKU、供应商或项目",
    columns: [{ key: "skuCode", label: "SKU" }, { key: "productName", label: "产品" }, { key: "supplierName", label: "供应商" }, { key: "unitPriceCents", label: "含税单价", format: "money", align: "right" }, { key: "freightCents", label: "运费", format: "money", align: "right" }, { key: "leadDays", label: "交期（天）", format: "number", align: "right" }, { key: "paymentTerms", label: "付款条件" }, { key: "status", label: "核价状态", format: "status" }],
    fields: [{ key: "skuId", label: "SKU", type: "reference", reference: "skus", required: true }, { key: "supplierId", label: "供应商", type: "reference", reference: "suppliers", required: true }, { key: "unitPriceYuan", label: "含税单价（元）", type: "number", required: true }, { key: "taxRatePercent", label: "税率（%）", type: "number", required: true }, { key: "freightYuan", label: "运费（元）", type: "number" }, { key: "installYuan", label: "安装费（元）", type: "number" }, { key: "leadDays", label: "交期（天）", type: "number", required: true }, { key: "paymentTerms", label: "付款条件", type: "text" }, { key: "attachmentUrl", label: "报价附件 URL", type: "text" }],
    query: `SELECT q.id,q.company_id AS "companyId",q.project_id AS "projectId",q.sku_id AS "skuId",q.supplier_id AS "supplierId",s.code AS "skuCode",s.name AS "productName",p.name AS "projectName",sup.name AS "supplierName",q.unit_price_cents AS "unitPriceCents",q.tax_rate_bps AS "taxRateBps",q.freight_cents AS "freightCents",q.install_cents AS "installCents",q.lead_days AS "leadDays",q.payment_terms AS "paymentTerms",q.attachment_url AS "attachmentUrl",q.status FROM supplier_quotes q JOIN skus s ON s.id=q.sku_id JOIN projects p ON p.id=q.project_id JOIN suppliers sup ON sup.id=q.supplier_id WHERE {scope} ORDER BY q.id DESC`, alias: "q", projectExpression: "q.project_id", emptyTitle: "暂无报价",
  },
  "purchase-requests": {
    key: "purchase-requests", title: "采购申请", eyebrow: "采购工作台", description: "所有对公与批量私账采购均进入老板审批。", searchPlaceholder: "搜索申请编号、项目或供应商",
    columns: [{ key: "number", label: "申请编号" }, { key: "projectName", label: "项目" }, { key: "supplierName", label: "供应商" }, { key: "paymentType", label: "付款类型", format: "status" }, { key: "amountCents", label: "申请金额", format: "money", align: "right" }, { key: "requesterName", label: "申请人" }, { key: "createdAt", label: "申请时间", format: "date" }, { key: "status", label: "审批状态", format: "status" }],
    fields: [{ key: "projectId", label: "所属项目", type: "reference", reference: "projects", required: true }, { key: "supplierId", label: "供应商", type: "reference", reference: "suppliers", required: true }, { key: "skuId", label: "采购 SKU", type: "reference", reference: "skus", required: true }, { key: "number", label: "申请编号", type: "text", required: true }, { key: "paymentType", label: "付款类型", type: "select", required: true, options: [{ value: "对公", label: "对公" }, { value: "批量私账", label: "批量私账" }] }, { key: "amountYuan", label: "申请金额（元）", type: "number", required: true }, { key: "attachmentUrl", label: "申请附件 URL", type: "text" }, { key: "reason", label: "采购说明", type: "textarea", required: true }],
    query: `SELECT r.id,r.company_id AS "companyId",r.project_id AS "projectId",r.supplier_id AS "supplierId",(SELECT sku_id FROM purchase_request_items WHERE request_id=r.id ORDER BY id LIMIT 1) AS "skuId",r.number,p.name AS "projectName",s.name AS "supplierName",r.payment_type AS "paymentType",r.amount_cents AS "amountCents",r.reason,r.attachment_url AS "attachmentUrl",u.name AS "requesterName",r.created_at::text AS "createdAt",r.status FROM purchase_requests r JOIN projects p ON p.id=r.project_id JOIN suppliers s ON s.id=r.supplier_id JOIN users u ON u.id=r.requested_by WHERE {scope} AND NOT r.is_void ORDER BY r.created_at DESC`, alias: "r", projectExpression: "r.project_id", emptyTitle: "暂无采购申请",
  },
  "purchase-orders": {
    key: "purchase-orders", title: "采购订单", eyebrow: "采购执行", description: "审批通过后自动生成，分别跟踪下单与到货成本。", searchPlaceholder: "搜索订单、项目或供应商",
    columns: [{ key: "number", label: "采购单号" }, { key: "projectName", label: "项目" }, { key: "supplierName", label: "供应商" }, { key: "amountCents", label: "已下单成本", format: "money", align: "right" }, { key: "deliveredCents", label: "已到货成本", format: "money", align: "right" }, { key: "orderedAt", label: "下单日期", format: "date" }, { key: "status", label: "状态", format: "status" }],
    query: `SELECT po.id,po.company_id AS "companyId",po.project_id AS "projectId",po.number,p.name AS "projectName",s.name AS "supplierName",po.amount_cents AS "amountCents",po.delivered_cents AS "deliveredCents",po.ordered_at::text AS "orderedAt",po.status FROM purchase_orders po JOIN projects p ON p.id=po.project_id JOIN suppliers s ON s.id=po.supplier_id WHERE {scope} AND NOT po.is_void ORDER BY po.ordered_at DESC`, alias: "po", projectExpression: "po.project_id", emptyTitle: "暂无采购订单",
  },
  payables: {
    key: "payables", title: "供应商应付", eyebrow: "采购财务", description: "采购单形成应付，持续跟踪付款节点、余额与发票状态。", searchPlaceholder: "搜索应付编号、项目或供应商",
    columns: [{ key: "number", label: "应付编号" }, { key: "projectName", label: "项目" }, { key: "supplierName", label: "供应商" }, { key: "paymentNode", label: "付款节点" }, { key: "amountCents", label: "应付金额", format: "money", align: "right" }, { key: "paidCents", label: "已付金额", format: "money", align: "right" }, { key: "remainingCents", label: "未付金额", format: "money", align: "right" }, { key: "dueDate", label: "应付日期", format: "date" }, { key: "invoiceStatus", label: "发票", format: "status" }, { key: "status", label: "状态", format: "status" }],
    query: `SELECT y.id,y.company_id AS "companyId",y.project_id AS "projectId",y.number,p.name AS "projectName",s.name AS "supplierName",y.payment_node AS "paymentNode",y.amount_cents AS "amountCents",y.paid_cents AS "paidCents",(y.amount_cents-y.paid_cents)::float8 AS "remainingCents",y.due_date::text AS "dueDate",y.invoice_status AS "invoiceStatus",y.status FROM payables y JOIN projects p ON p.id=y.project_id JOIN suppliers s ON s.id=y.supplier_id WHERE {scope} AND NOT y.is_void ORDER BY y.due_date`, alias: "y", projectExpression: "y.project_id", emptyTitle: "暂无应付",
  },
  "payment-requests": {
    key: "payment-requests", title: "付款申请", eyebrow: "资金审批", description: "申请、老板审批、财务付款和结果登记形成闭环。", searchPlaceholder: "搜索申请编号、项目或供应商",
    columns: [{ key: "number", label: "付款申请" }, { key: "projectName", label: "项目" }, { key: "supplierName", label: "收款方" }, { key: "amountCents", label: "申请金额", format: "money", align: "right" }, { key: "accountName", label: "付款账户" }, { key: "requesterName", label: "申请人" }, { key: "createdAt", label: "申请日期", format: "date" }, { key: "status", label: "审批状态", format: "status" }],
    fields: [{ key: "payableId", label: "关联应付", type: "reference", reference: "payables", required: true }, { key: "accountId", label: "付款账户", type: "reference", reference: "accounts", required: true }, { key: "number", label: "申请编号", type: "text", required: true }, { key: "amountYuan", label: "申请金额（元）", type: "number", required: true }, { key: "reason", label: "付款说明", type: "textarea", required: true }],
    query: `SELECT r.id,r.company_id AS "companyId",r.project_id AS "projectId",r.payable_id AS "payableId",r.account_id AS "accountId",r.number,p.name AS "projectName",s.name AS "supplierName",r.amount_cents AS "amountCents",r.reason,a.name AS "accountName",u.name AS "requesterName",r.created_at::text AS "createdAt",r.status FROM payment_requests r JOIN payables y ON y.id=r.payable_id JOIN projects p ON p.id=r.project_id JOIN suppliers s ON s.id=y.supplier_id LEFT JOIN company_accounts a ON a.id=r.account_id JOIN users u ON u.id=r.requested_by WHERE {scope} AND NOT r.is_void ORDER BY r.created_at DESC`, alias: "r", projectExpression: "r.project_id", emptyTitle: "暂无付款申请",
  },
  payments: {
    key: "payments", title: "付款记录", eyebrow: "资金执行", description: "经审批的实际付款及对应账户、应付余额。", searchPlaceholder: "搜索付款编号、项目或供应商",
    columns: [{ key: "number", label: "付款编号" }, { key: "projectName", label: "项目" }, { key: "supplierName", label: "供应商" }, { key: "amountCents", label: "付款金额", format: "money", align: "right" }, { key: "accountName", label: "付款账户" }, { key: "method", label: "方式" }, { key: "receiptEvidence", label: "银行回单", format: "status" }, { key: "paidAt", label: "付款日期", format: "date" }, { key: "status", label: "状态", format: "status" }],
    query: `SELECT f.id,f.company_id AS "companyId",f.project_id AS "projectId",f.number,p.name AS "projectName",s.name AS "supplierName",f.amount_cents AS "amountCents",a.name AS "accountName",f.method,CASE WHEN f.bank_receipt_url IS NULL THEN '未上传' ELSE '已上传' END AS "receiptEvidence",f.bank_receipt_url AS "bankReceiptUrl",f.paid_at::text AS "paidAt",f.status FROM payments f JOIN payables y ON y.id=f.payable_id JOIN projects p ON p.id=f.project_id JOIN suppliers s ON s.id=y.supplier_id LEFT JOIN company_accounts a ON a.id=f.account_id WHERE {scope} AND NOT f.is_void ORDER BY f.paid_at DESC`, alias: "f", projectExpression: "f.project_id", emptyTitle: "暂无付款记录",
  },
  invoices: {
    key: "invoices", title: "发票台账", eyebrow: "票据", description: "销项与进项发票统一登记，实时识别客户未开票和供应商欠票。", searchPlaceholder: "搜索发票号、项目或往来单位",
    columns: [{ key: "number", label: "发票号码" }, { key: "projectName", label: "项目" }, { key: "direction", label: "方向", format: "status" }, { key: "type", label: "票种" }, { key: "counterparty", label: "往来单位" }, { key: "amountCents", label: "票面金额", format: "money", align: "right" }, { key: "allocatedCents", label: "已核销", format: "money", align: "right" }, { key: "unallocatedCents", label: "未核销", format: "money", align: "right" }, { key: "issuedAt", label: "开票日期", format: "date" }, { key: "status", label: "状态", format: "status" }],
    fields: [{ key: "direction", label: "发票方向", type: "select", required: true, options: [{ value: "销项", label: "销项发票" }, { value: "进项", label: "进项发票" }] }, { key: "payableId", label: "核销应付（进项）", type: "reference", reference: "payables" }, { key: "receivablePlanId", label: "核销应收节点（销项）", type: "reference", reference: "receivables" }, { key: "number", label: "发票号码", type: "text", required: true }, { key: "type", label: "票种", type: "select", required: true, options: ["专票", "普票", "电子票", "红票", "收据"].map((value) => ({ value, label: value })) }, { key: "amountYuan", label: "票面及核销金额（元）", type: "number", required: true }, { key: "issuedAt", label: "开票日期", type: "date", required: true }],
    query: `SELECT i.id,i.company_id AS "companyId",i.project_id AS "projectId",i.number,p.name AS "projectName",i.direction,i.type,COALESCE(cu.name,s.name) AS counterparty,i.amount_cents AS "amountCents",COALESCE((SELECT sum(a.amount_cents) FROM invoice_allocations a WHERE a.invoice_id=i.id),0)::float8 AS "allocatedCents",(i.amount_cents-COALESCE((SELECT sum(a.amount_cents) FROM invoice_allocations a WHERE a.invoice_id=i.id),0))::float8 AS "unallocatedCents",i.issued_at::text AS "issuedAt",i.status FROM invoices i JOIN projects p ON p.id=i.project_id LEFT JOIN customers cu ON cu.id=i.customer_id LEFT JOIN suppliers s ON s.id=i.supplier_id WHERE {scope} AND NOT i.is_void ORDER BY i.issued_at DESC`, alias: "i", projectExpression: "i.project_id", emptyTitle: "暂无发票",
  },
  changes: {
    key: "changes", title: "项目变更", eyebrow: "预算版本", description: "增项、减项与换品保留调整前后金额和审批记录。", searchPlaceholder: "搜索变更编号、项目或原因",
    columns: [{ key: "number", label: "变更编号" }, { key: "projectName", label: "项目" }, { key: "type", label: "变更类型", format: "status" }, { key: "originalCents", label: "调整前", format: "money", align: "right" }, { key: "adjustmentCents", label: "调整金额", format: "money", align: "right" }, { key: "newCents", label: "调整后", format: "money", align: "right" }, { key: "reason", label: "原因" }, { key: "status", label: "状态", format: "status" }],
    query: `SELECT ch.id,ch.company_id AS "companyId",ch.project_id AS "projectId",ch.number,p.name AS "projectName",ch.type,ch.original_cents AS "originalCents",ch.adjustment_cents AS "adjustmentCents",ch.new_cents AS "newCents",ch.reason,ch.status FROM project_changes ch JOIN projects p ON p.id=ch.project_id WHERE {scope} ORDER BY ch.created_at DESC`, alias: "ch", projectExpression: "ch.project_id", emptyTitle: "暂无变更",
  },
  returns: {
    key: "returns", title: "退换货与冲销", eyebrow: "采购异常", description: "采购取消、退货、换货不删除原记录，通过冲销影响订单与应付。", searchPlaceholder: "搜索退货单、项目或原因",
    columns: [{ key: "number", label: "业务编号" }, { key: "projectName", label: "项目" }, { key: "orderNumber", label: "采购单" }, { key: "type", label: "类型", format: "status" }, { key: "quantity", label: "数量", format: "number", align: "right" }, { key: "amountCents", label: "冲减金额", format: "money", align: "right" }, { key: "reason", label: "原因" }, { key: "status", label: "状态", format: "status" }],
    fields: [{ key: "purchaseOrderId", label: "采购订单", type: "reference", reference: "purchase-orders", required: true }, { key: "number", label: "业务编号", type: "text", required: true }, { key: "type", label: "业务类型", type: "select", required: true, options: ["采购取消", "退货", "换货", "退款"].map((value) => ({ value, label: value })) }, { key: "quantity", label: "数量（取消/退款可填 0）", type: "number", required: true }, { key: "amountYuan", label: "金额（元）", type: "number", required: true }, { key: "accountId", label: "退款账户（退款时必选）", type: "reference", reference: "accounts" }, { key: "reason", label: "原因", type: "textarea", required: true }],
    query: `SELECT pr.id,pr.company_id AS "companyId",pr.project_id AS "projectId",pr.number,p.name AS "projectName",po.number AS "orderNumber",pr.type,pr.quantity,pr.amount_cents AS "amountCents",pr.reason,pr.status FROM purchase_returns pr JOIN projects p ON p.id=pr.project_id JOIN purchase_orders po ON po.id=pr.purchase_order_id WHERE {scope} AND NOT pr.is_void ORDER BY pr.created_at DESC`, alias: "pr", projectExpression: "pr.project_id", emptyTitle: "暂无退换货",
  },
  inventory: {
    key: "inventory", title: "库存批次", eyebrow: "到货与出库", description: "按采购批次查看项目库存、退换货联动和剩余数量。", searchPlaceholder: "搜索批次、SKU 或项目",
    columns: [{ key: "batchNumber", label: "批次" }, { key: "projectName", label: "项目" }, { key: "skuCode", label: "SKU" }, { key: "skuName", label: "产品" }, { key: "quantity", label: "入库数量", format: "number", align: "right" }, { key: "remainingQuantity", label: "剩余数量", format: "number", align: "right" }, { key: "unitCostCents", label: "单位成本", format: "money", align: "right" }, { key: "status", label: "状态", format: "status" }],
    query: `SELECT b.id,b.company_id AS "companyId",b.project_id AS "projectId",b.batch_number AS "batchNumber",p.name AS "projectName",s.code AS "skuCode",s.name AS "skuName",b.quantity,b.remaining_quantity AS "remainingQuantity",b.unit_cost_cents AS "unitCostCents",b.status FROM inventory_batches b JOIN projects p ON p.id=b.project_id JOIN skus s ON s.id=b.sku_id WHERE {scope} ORDER BY b.id DESC`, alias: "b", projectExpression: "b.project_id", emptyTitle: "暂无库存批次",
  },
  "audit-logs": {
    key: "audit-logs", title: "操作日志", eyebrow: "审计追溯", description: "关键对象的创建、修改、审批、作废与冲销完整留痕。", searchPlaceholder: "搜索操作人、业务对象或动作",
    columns: [{ key: "createdAt", label: "时间", format: "date" }, { key: "userName", label: "操作人" }, { key: "objectType", label: "业务对象" }, { key: "objectId", label: "对象 ID", format: "number", align: "right" }, { key: "action", label: "操作", format: "status" }, { key: "projectName", label: "项目" }, { key: "ip", label: "IP" }],
    query: `SELECT l.id,l.company_id AS "companyId",l.project_id AS "projectId",l.created_at::text AS "createdAt",u.name AS "userName",l.object_type AS "objectType",l.object_id AS "objectId",l.action,COALESCE(p.name,'-') AS "projectName",l.ip FROM audit_logs l LEFT JOIN users u ON u.id=l.user_id LEFT JOIN projects p ON p.id=l.project_id WHERE {scope} ORDER BY l.created_at DESC LIMIT 500`, alias: "l", projectExpression: "l.project_id", emptyTitle: "暂无操作日志",
  },
};

function buildScope(definition: ResourceDefinition, user: SessionUser, scope: number | null) {
  const params: unknown[] = [];
  const conditions: string[] = [];
  if (definition.key === "companies") {
    if (scope !== null) { params.push(scope); conditions.push(`${definition.alias}.id=$${params.length}`); }
  } else if (scope !== null) {
    params.push(scope); conditions.push(`${definition.alias}.company_id=$${params.length}`);
  }
  if ((user.role === "project_manager" || user.role === "designer") && definition.projectExpression) {
    params.push(user.id);
    conditions.push(`EXISTS (SELECT 1 FROM project_members pm_scope WHERE pm_scope.project_id=${definition.projectExpression} AND pm_scope.user_id=$${params.length})`);
  }
  if (definition.key === "customers" && (user.role === "project_manager" || user.role === "designer")) {
    params.push(user.id);
    conditions.push(`EXISTS (SELECT 1 FROM projects p_scope JOIN project_members pm_scope ON pm_scope.project_id=p_scope.id WHERE p_scope.customer_id=cu.id AND pm_scope.user_id=$${params.length})`);
  }
  return { sql: conditions.length ? conditions.join(" AND ") : "TRUE", params };
}

export async function getResourceData(resource: ResourceKey, user: SessionUser, scope: number | null) {
  assertCan(user, resource, "read");
  const definition = definitions[resource];
  if (!definition) return null;
  const scoped = buildScope(definition, user, scope);
  const rows = await sqlQuery(definition.query.replace("{scope}", scoped.sql), scoped.params);
  return { definition, rows };
}

export async function getReferenceOptions(reference: NonNullable<FieldDef["reference"]>, user: SessionUser, scope: number | null) {
  const company = scope === null ? { sql: "TRUE", params: [] as unknown[] } : { sql: "company_id=$1", params: [scope] as unknown[] };
  const projectMember = user.role === "project_manager" || user.role === "designer";
  switch (reference) {
    case "companies": return sqlQuery<{ value: string; label: string }>(`SELECT id::text AS value,name AS label FROM companies ${scope === null ? "" : "WHERE id=$1"} ORDER BY id`, scope === null ? [] : [scope]);
    case "customers": return sqlQuery<{ value: string; label: string }>(`SELECT id::text AS value,name AS label FROM customers WHERE ${company.sql} ORDER BY name`, company.params);
    case "suppliers": return sqlQuery<{ value: string; label: string }>(`SELECT id::text AS value,name AS label FROM suppliers WHERE ${company.sql} ORDER BY name`, company.params);
    case "projects": {
      const params = [...company.params];
      const memberSql = projectMember ? ` AND EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id=projects.id AND pm.user_id=$${params.push(user.id)})` : "";
      return sqlQuery<{ value: string; label: string }>(`SELECT id::text AS value,code||' · '||name AS label FROM projects WHERE ${company.sql}${memberSql} ORDER BY name`, params);
    }
    case "contracts": {
      const params: unknown[] = []; const conditions: string[] = [];
      if (scope !== null) { params.push(scope); conditions.push(`ct.company_id=$${params.length}`); }
      if (projectMember) { params.push(user.id); conditions.push(`EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id=ct.project_id AND pm.user_id=$${params.length})`); }
      return sqlQuery<{ value: string; label: string }>(`SELECT ct.id::text AS value,ct.number||' · '||p.name AS label FROM contracts ct JOIN projects p ON p.id=ct.project_id WHERE ${conditions.length ? conditions.join(" AND ") : "TRUE"} AND NOT ct.is_void ORDER BY ct.id DESC`, params);
    }
    case "receivables": {
      const params: unknown[] = []; const conditions: string[] = [];
      if (scope !== null) { params.push(scope); conditions.push(`rp.company_id=$${params.length}`); }
      if (projectMember) { params.push(user.id); conditions.push(`EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id=rp.project_id AND pm.user_id=$${params.length})`); }
      return sqlQuery<{ value: string; label: string }>(`SELECT rp.id::text AS value,p.name||' · '||rp.node_name||' · ¥'||round((rp.amount_cents-rp.received_cents)/100.0,2)::text AS label FROM receivable_plans rp JOIN projects p ON p.id=rp.project_id WHERE ${conditions.length ? conditions.join(" AND ") : "TRUE"} AND NOT rp.is_void AND rp.received_cents<rp.amount_cents ORDER BY rp.due_date`, params);
    }
    case "accounts": return sqlQuery<{ value: string; label: string }>(`SELECT id::text AS value,name||' · '||COALESCE(bank,type) AS label FROM company_accounts WHERE ${company.sql} AND status='active' ORDER BY name`, company.params);
    case "skus": {
      const params: unknown[] = []; const conditions: string[] = [];
      if (scope !== null) { params.push(scope); conditions.push(`s.company_id=$${params.length}`); }
      if (projectMember) { params.push(user.id); conditions.push(`EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id=s.project_id AND pm.user_id=$${params.length})`); }
      return sqlQuery<{ value: string; label: string }>(`SELECT s.id::text AS value,s.code||' · '||s.name AS label FROM skus s WHERE ${conditions.length ? conditions.join(" AND ") : "TRUE"} ORDER BY s.id DESC LIMIT 500`, params);
    }
    case "payables": {
      const params: unknown[] = []; const conditions: string[] = [];
      if (scope !== null) { params.push(scope); conditions.push(`y.company_id=$${params.length}`); }
      if (projectMember) { params.push(user.id); conditions.push(`EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id=y.project_id AND pm.user_id=$${params.length})`); }
      return sqlQuery<{ value: string; label: string }>(`SELECT y.id::text AS value,y.number||' · '||s.name||' · ¥'||round((y.amount_cents-y.paid_cents)/100.0,2)::text AS label FROM payables y JOIN suppliers s ON s.id=y.supplier_id WHERE ${conditions.length ? conditions.join(" AND ") : "TRUE"} AND NOT y.is_void AND y.paid_cents<y.amount_cents ORDER BY y.due_date`, params);
    }
    case "purchase-orders": return sqlQuery<{ value: string; label: string }>(`SELECT id::text AS value,number AS label FROM purchase_orders WHERE ${company.sql} AND NOT is_void ORDER BY id DESC`, company.params);
  }
}
