import {
  boolean,
  integer,
  jsonb,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const money = (name: string) => numeric(name, { precision: 18, scale: 0, mode: "number" });
const decimalQuantity = (name: string) => numeric(name, { precision: 18, scale: 4, mode: "number" });

const auditColumns = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: integer("created_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: integer("updated_by"),
};

const financeColumns = {
  version: integer("version").notNull().default(1),
  isVoid: boolean("is_void").notNull().default(false),
  voidReason: text("void_reason"),
};

export const companies = pgTable("companies", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  legalRepresentative: text("legal_representative"),
  status: text("status").notNull().default("active"),
  ...auditColumns,
});

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").references(() => companies.id),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: text("role").notNull(),
  status: text("status").notNull().default("active"),
  ...auditColumns,
});

export const companyAccounts = pgTable("company_accounts", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companies.id),
  name: text("name").notNull(),
  type: text("type").notNull(),
  bank: text("bank"),
  lastFour: text("last_four"),
  balanceCents: money("balance_cents").notNull().default(0),
  status: text("status").notNull().default("active"),
  note: text("note"),
  ...auditColumns,
});

export const customers = pgTable("customers", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companies.id),
  code: text("code").notNull(),
  name: text("name").notNull(),
  type: text("type").notNull().default("企业客户"),
  contact: text("contact"),
  phone: text("phone"),
  status: text("status").notNull().default("active"),
  ...auditColumns,
}, (table) => [uniqueIndex("customers_company_code_idx").on(table.companyId, table.code)]);

export const suppliers = pgTable("suppliers", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companies.id),
  code: text("code").notNull(),
  name: text("name").notNull(),
  category: text("category").notNull(),
  contact: text("contact"),
  phone: text("phone"),
  taxNumber: text("tax_number"),
  status: text("status").notNull().default("active"),
  ...auditColumns,
}, (table) => [uniqueIndex("suppliers_company_code_idx").on(table.companyId, table.code)]);

export const projects = pgTable("projects", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companies.id),
  customerId: integer("customer_id").notNull().references(() => customers.id),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  address: text("address"),
  ownerId: integer("owner_id").references(() => users.id),
  managerId: integer("manager_id").references(() => users.id),
  designerId: integer("designer_id").references(() => users.id),
  originalContractCents: money("original_contract_cents").notNull().default(0),
  currentContractCents: money("current_contract_cents").notNull().default(0),
  budgetCents: money("budget_cents").notNull().default(0),
  startDate: timestamp("start_date", { withTimezone: true }),
  expectedEndDate: timestamp("expected_end_date", { withTimezone: true }),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  warrantyEndDate: timestamp("warranty_end_date", { withTimezone: true }),
  auditStatus: text("audit_status").notNull().default("未开始"),
  status: text("status").notNull().default("待启动"),
  note: text("note"),
  ...auditColumns,
});

export const projectMembers = pgTable("project_members", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projects.id),
  userId: integer("user_id").notNull().references(() => users.id),
  responsibility: text("responsibility").notNull(),
  ...auditColumns,
}, (table) => [uniqueIndex("project_member_unique_idx").on(table.projectId, table.userId)]);

export const projectBudgetVersions = pgTable("project_budget_versions", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companies.id),
  projectId: integer("project_id").notNull().references(() => projects.id),
  version: integer("version").notNull(),
  type: text("type").notNull(),
  amountCents: money("amount_cents").notNull(),
  status: text("status").notNull().default("已生效"),
  note: text("note"),
  ...auditColumns,
}, (table) => [uniqueIndex("budget_project_version_idx").on(table.projectId, table.version)]);

export const projectChanges = pgTable("project_changes", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companies.id),
  projectId: integer("project_id").notNull().references(() => projects.id),
  number: text("number").notNull().unique(),
  type: text("type").notNull(),
  originalCents: money("original_cents").notNull(),
  adjustmentCents: money("adjustment_cents").notNull(),
  newCents: money("new_cents").notNull(),
  reason: text("reason").notNull(),
  applicantId: integer("applicant_id").notNull().references(() => users.id),
  approverId: integer("approver_id").references(() => users.id),
  status: text("status").notNull().default("待审批"),
  ...auditColumns,
});

export const contracts = pgTable("contracts", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companies.id),
  projectId: integer("project_id").notNull().references(() => projects.id),
  number: text("number").notNull().unique(),
  name: text("name").notNull(),
  amountCents: money("amount_cents").notNull(),
  signedAt: timestamp("signed_at", { withTimezone: true }),
  attachmentUrl: text("attachment_url"),
  status: text("status").notNull().default("生效中"),
  ...financeColumns,
  ...auditColumns,
});

export const receivablePlans = pgTable("receivable_plans", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companies.id),
  projectId: integer("project_id").notNull().references(() => projects.id),
  contractId: integer("contract_id").notNull().references(() => contracts.id),
  nodeName: text("node_name").notNull(),
  ratioBps: integer("ratio_bps").notNull(),
  amountCents: money("amount_cents").notNull(),
  receivedCents: money("received_cents").notNull().default(0),
  dueDate: timestamp("due_date", { withTimezone: true }).notNull(),
  isWarranty: boolean("is_warranty").notNull().default(false),
  status: text("status").notNull().default("未到期"),
  note: text("note"),
  ...financeColumns,
  ...auditColumns,
});

export const receipts = pgTable("receipts", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companies.id),
  projectId: integer("project_id").notNull().references(() => projects.id),
  receivablePlanId: integer("receivable_plan_id").notNull().references(() => receivablePlans.id),
  accountId: integer("account_id").references(() => companyAccounts.id),
  number: text("number").notNull().unique(),
  amountCents: money("amount_cents").notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
  method: text("method").notNull().default("银行转账"),
  bankReceiptUrl: text("bank_receipt_url"),
  status: text("status").notNull().default("已确认"),
  ...financeColumns,
  ...auditColumns,
});

export const skus = pgTable("skus", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companies.id),
  projectId: integer("project_id").notNull().references(() => projects.id),
  code: text("code").notNull(),
  room: text("room"),
  category: text("category").notNull(),
  name: text("name").notNull(),
  brand: text("brand"),
  model: text("model"),
  specification: text("specification"),
  material: text("material"),
  color: text("color"),
  imageUrl: text("image_url"),
  quantity: decimalQuantity("quantity").notNull(),
  unit: text("unit").notNull(),
  budgetUnitCents: money("budget_unit_cents").notNull(),
  finalUnitCents: money("final_unit_cents"),
  supplierId: integer("supplier_id").references(() => suppliers.id),
  taxRateBps: integer("tax_rate_bps").notNull().default(1300),
  freightCents: money("freight_cents").notNull().default(0),
  installCents: money("install_cents").notNull().default(0),
  leadDays: integer("lead_days"),
  status: text("status").notNull().default("待询价"),
  note: text("note"),
  ...auditColumns,
}, (table) => [uniqueIndex("skus_project_code_idx").on(table.projectId, table.code)]);

export const supplierQuotes = pgTable("supplier_quotes", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companies.id),
  projectId: integer("project_id").notNull().references(() => projects.id),
  skuId: integer("sku_id").notNull().references(() => skus.id),
  supplierId: integer("supplier_id").notNull().references(() => suppliers.id),
  unitPriceCents: money("unit_price_cents").notNull(),
  taxIncluded: boolean("tax_included").notNull().default(true),
  taxRateBps: integer("tax_rate_bps").notNull().default(1300),
  freightCents: money("freight_cents").notNull().default(0),
  installCents: money("install_cents").notNull().default(0),
  leadDays: integer("lead_days").notNull(),
  validUntil: timestamp("valid_until", { withTimezone: true }),
  paymentTerms: text("payment_terms"),
  attachmentUrl: text("attachment_url"),
  status: text("status").notNull().default("待核价"),
  ...auditColumns,
});

export const purchaseRequests = pgTable("purchase_requests", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companies.id),
  projectId: integer("project_id").notNull().references(() => projects.id),
  number: text("number").notNull().unique(),
  supplierId: integer("supplier_id").notNull().references(() => suppliers.id),
  paymentType: text("payment_type").notNull().default("对公"),
  amountCents: money("amount_cents").notNull(),
  requestedBy: integer("requested_by").notNull().references(() => users.id),
  status: text("status").notNull().default("草稿"),
  reason: text("reason"),
  attachmentUrl: text("attachment_url"),
  ...financeColumns,
  ...auditColumns,
});

export const purchaseRequestItems = pgTable("purchase_request_items", {
  id: serial("id").primaryKey(),
  requestId: integer("request_id").notNull().references(() => purchaseRequests.id),
  skuId: integer("sku_id").notNull().references(() => skus.id),
  quoteId: integer("quote_id").references(() => supplierQuotes.id),
  quantity: decimalQuantity("quantity").notNull(),
  unitPriceCents: money("unit_price_cents").notNull(),
  amountCents: money("amount_cents").notNull(),
  ...auditColumns,
});

export const purchaseApprovals = pgTable("purchase_approvals", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companies.id),
  projectId: integer("project_id").notNull().references(() => projects.id),
  requestId: integer("request_id").notNull().references(() => purchaseRequests.id),
  approverId: integer("approver_id").notNull().references(() => users.id),
  decision: text("decision").notNull(),
  comment: text("comment"),
  decidedAt: timestamp("decided_at", { withTimezone: true }).notNull().defaultNow(),
});

export const purchaseOrders = pgTable("purchase_orders", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companies.id),
  projectId: integer("project_id").notNull().references(() => projects.id),
  requestId: integer("request_id").notNull().references(() => purchaseRequests.id),
  supplierId: integer("supplier_id").notNull().references(() => suppliers.id),
  number: text("number").notNull().unique(),
  amountCents: money("amount_cents").notNull(),
  deliveredCents: money("delivered_cents").notNull().default(0),
  status: text("status").notNull().default("已下单"),
  orderedAt: timestamp("ordered_at", { withTimezone: true }).notNull().defaultNow(),
  ...financeColumns,
  ...auditColumns,
});

export const goodsReceipts = pgTable("goods_receipts", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companies.id),
  projectId: integer("project_id").notNull().references(() => projects.id),
  purchaseOrderId: integer("purchase_order_id").notNull().references(() => purchaseOrders.id),
  number: text("number").notNull().unique(),
  quantity: decimalQuantity("quantity").notNull(),
  amountCents: money("amount_cents").notNull(),
  destination: text("destination").notNull().default("项目直送"),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
  status: text("status").notNull().default("已验收"),
  ...financeColumns,
  ...auditColumns,
});

export const purchaseReturns = pgTable("purchase_returns", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companies.id),
  projectId: integer("project_id").notNull().references(() => projects.id),
  purchaseOrderId: integer("purchase_order_id").notNull().references(() => purchaseOrders.id),
  payableId: integer("payable_id").references(() => payables.id),
  number: text("number").notNull().unique(),
  type: text("type").notNull().default("退货"),
  amountCents: money("amount_cents").notNull(),
  quantity: decimalQuantity("quantity").notNull().default(0),
  reason: text("reason").notNull(),
  status: text("status").notNull().default("已完成"),
  ...financeColumns,
  ...auditColumns,
});

export const payables = pgTable("payables", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companies.id),
  projectId: integer("project_id").notNull().references(() => projects.id),
  supplierId: integer("supplier_id").notNull().references(() => suppliers.id),
  purchaseOrderId: integer("purchase_order_id").notNull().references(() => purchaseOrders.id),
  number: text("number").notNull().unique(),
  amountCents: money("amount_cents").notNull(),
  paidCents: money("paid_cents").notNull().default(0),
  dueDate: timestamp("due_date", { withTimezone: true }).notNull(),
  paymentNode: text("payment_node").notNull(),
  invoiceStatus: text("invoice_status").notNull().default("欠票"),
  status: text("status").notNull().default("待付"),
  note: text("note"),
  ...financeColumns,
  ...auditColumns,
});

export const paymentRequests = pgTable("payment_requests", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companies.id),
  projectId: integer("project_id").notNull().references(() => projects.id),
  payableId: integer("payable_id").notNull().references(() => payables.id),
  number: text("number").notNull().unique(),
  amountCents: money("amount_cents").notNull(),
  accountId: integer("account_id").references(() => companyAccounts.id),
  requestedBy: integer("requested_by").notNull().references(() => users.id),
  status: text("status").notNull().default("待审批"),
  reason: text("reason"),
  ...financeColumns,
  ...auditColumns,
});

export const paymentApprovals = pgTable("payment_approvals", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companies.id),
  projectId: integer("project_id").notNull().references(() => projects.id),
  paymentRequestId: integer("payment_request_id").notNull().references(() => paymentRequests.id),
  approverId: integer("approver_id").notNull().references(() => users.id),
  decision: text("decision").notNull(),
  comment: text("comment"),
  decidedAt: timestamp("decided_at", { withTimezone: true }).notNull().defaultNow(),
});

export const payments = pgTable("payments", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companies.id),
  projectId: integer("project_id").notNull().references(() => projects.id),
  payableId: integer("payable_id").notNull().references(() => payables.id),
  paymentRequestId: integer("payment_request_id").references(() => paymentRequests.id),
  accountId: integer("account_id").references(() => companyAccounts.id),
  number: text("number").notNull().unique(),
  amountCents: money("amount_cents").notNull(),
  paidAt: timestamp("paid_at", { withTimezone: true }).notNull(),
  method: text("method").notNull(),
  bankReceiptUrl: text("bank_receipt_url"),
  status: text("status").notNull().default("已付款"),
  ...financeColumns,
  ...auditColumns,
});

export const invoices = pgTable("invoices", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companies.id),
  projectId: integer("project_id").notNull().references(() => projects.id),
  customerId: integer("customer_id").references(() => customers.id),
  supplierId: integer("supplier_id").references(() => suppliers.id),
  number: text("number").notNull(),
  direction: text("direction").notNull(),
  type: text("type").notNull(),
  amountCents: money("amount_cents").notNull(),
  issuedAt: timestamp("issued_at", { withTimezone: true }).notNull(),
  status: text("status").notNull().default("正常"),
  ...financeColumns,
  ...auditColumns,
}, (table) => [uniqueIndex("invoices_company_number_idx").on(table.companyId, table.number)]);

export const invoiceAllocations = pgTable("invoice_allocations", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companies.id),
  projectId: integer("project_id").notNull().references(() => projects.id),
  invoiceId: integer("invoice_id").notNull().references(() => invoices.id),
  payableId: integer("payable_id").references(() => payables.id),
  receivablePlanId: integer("receivable_plan_id").references(() => receivablePlans.id),
  amountCents: money("amount_cents").notNull(),
  ...auditColumns,
});

export const inventoryBatches = pgTable("inventory_batches", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companies.id),
  projectId: integer("project_id").notNull().references(() => projects.id),
  skuId: integer("sku_id").notNull().references(() => skus.id),
  purchaseOrderId: integer("purchase_order_id").references(() => purchaseOrders.id),
  batchNumber: text("batch_number").notNull().unique(),
  quantity: decimalQuantity("quantity").notNull(),
  remainingQuantity: decimalQuantity("remaining_quantity").notNull(),
  unitCostCents: money("unit_cost_cents").notNull(),
  status: text("status").notNull().default("在库"),
  ...auditColumns,
});

export const inventoryTransactions = pgTable("inventory_transactions", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companies.id),
  projectId: integer("project_id").notNull().references(() => projects.id),
  batchId: integer("batch_id").notNull().references(() => inventoryBatches.id),
  type: text("type").notNull(),
  quantity: decimalQuantity("quantity").notNull(),
  amountCents: money("amount_cents").notNull(),
  happenedAt: timestamp("happened_at", { withTimezone: true }).notNull(),
  note: text("note"),
  ...auditColumns,
});

export const shareholderAdvances = pgTable("shareholder_advances", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companies.id),
  projectId: integer("project_id").references(() => projects.id),
  personName: text("person_name").notNull(),
  type: text("type").notNull(),
  amountCents: money("amount_cents").notNull(),
  happenedAt: timestamp("happened_at", { withTimezone: true }).notNull(),
  status: text("status").notNull().default("未归还"),
  note: text("note"),
  ...financeColumns,
  ...auditColumns,
});

export const auditLogs = pgTable("audit_logs", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").references(() => companies.id),
  projectId: integer("project_id").references(() => projects.id),
  userId: integer("user_id").references(() => users.id),
  objectType: text("object_type").notNull(),
  objectId: integer("object_id"),
  action: text("action").notNull(),
  before: jsonb("before"),
  after: jsonb("after"),
  ip: text("ip"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const attachments = pgTable("attachments", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companies.id),
  projectId: integer("project_id").references(() => projects.id),
  objectType: text("object_type").notNull(),
  objectId: integer("object_id").notNull(),
  category: text("category").notNull(),
  filename: text("filename").notNull(),
  originalFilename: text("original_filename").notNull(),
  mimeType: text("mime_type").notNull(),
  fileSize: integer("file_size").notNull(),
  storageKey: text("storage_key").notNull().unique(),
  url: text("url").notNull(),
  uploadedBy: integer("uploaded_by").notNull().references(() => users.id),
  isVoid: boolean("is_void").notNull().default(false),
  voidReason: text("void_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: integer("updated_by"),
});

export const loginAttempts = pgTable("login_attempts", {
  id: serial("id").primaryKey(),
  email: text("email").notNull(),
  ip: text("ip").notNull(),
  userId: integer("user_id").references(() => users.id),
  success: boolean("success").notNull().default(false),
  attemptedAt: timestamp("attempted_at", { withTimezone: true }).notNull().defaultNow(),
});

export const importJobs = pgTable("import_jobs", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companies.id),
  userId: integer("user_id").notNull().references(() => users.id),
  resource: text("resource").notNull(),
  filename: text("filename").notNull(),
  sourceHash: text("source_hash"),
  totalRows: integer("total_rows").notNull(),
  successRows: integer("success_rows").notNull().default(0),
  errorRows: integer("error_rows").notNull().default(0),
  status: text("status").notNull(),
  errors: jsonb("errors"),
  migrationBatchId: integer("migration_batch_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const importMappingTemplates = pgTable("import_mapping_templates", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").references(() => companies.id),
  name: text("name").notNull(),
  businessType: text("business_type").notNull(),
  sheetSignature: text("sheet_signature").notNull(),
  sourceFields: jsonb("source_fields").notNull(),
  fieldMappings: jsonb("field_mappings").notNull(),
  transformRules: jsonb("transform_rules").notNull().default({}),
  createdBy: integer("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: integer("updated_by"),
}, (table) => [uniqueIndex("import_mapping_template_signature_idx").on(table.companyId, table.businessType, table.sheetSignature)]);

export const importBatches = pgTable("import_batches", {
  id: serial("id").primaryKey(),
  batchNumber: text("batch_number").notNull().unique(),
  companyId: integer("company_id").references(() => companies.id),
  userId: integer("user_id").notNull().references(() => users.id),
  mode: text("mode").notNull().default("HISTORY"),
  businessType: text("business_type"),
  sourceHash: text("source_hash").notNull(),
  mappingTemplateId: integer("mapping_template_id").references(() => importMappingTemplates.id),
  totalRows: integer("total_rows").notNull().default(0),
  readyRows: integer("ready_rows").notNull().default(0),
  warningRows: integer("warning_rows").notNull().default(0),
  errorRows: integer("error_rows").notNull().default(0),
  successRows: integer("success_rows").notNull().default(0),
  skippedRows: integer("skipped_rows").notNull().default(0),
  status: text("status").notNull().default("UPLOADED"),
  errorMessage: text("error_message"),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  rolledBackAt: timestamp("rolled_back_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const importFiles = pgTable("import_files", {
  id: serial("id").primaryKey(),
  batchId: integer("batch_id").notNull().references(() => importBatches.id),
  filename: text("filename").notNull(),
  fileSize: integer("file_size").notNull(),
  fileHash: text("file_hash").notNull(),
  sheetCount: integer("sheet_count").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const importSheets = pgTable("import_sheets", {
  id: serial("id").primaryKey(),
  batchId: integer("batch_id").notNull().references(() => importBatches.id),
  fileId: integer("file_id").notNull().references(() => importFiles.id),
  sheetIndex: integer("sheet_index").notNull(),
  name: text("name").notNull(),
  rowCount: integer("row_count").notNull(),
  columnCount: integer("column_count").notNull(),
  headers: jsonb("headers").notNull(),
  previewRows: jsonb("preview_rows").notNull(),
  rawRows: jsonb("raw_rows").notNull(),
  selected: boolean("selected").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("import_sheet_batch_index_idx").on(table.batchId, table.sheetIndex)]);

export const entityAliases = pgTable("entity_aliases", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companies.id),
  entityType: text("entity_type").notNull(),
  entityId: integer("entity_id").notNull(),
  alias: text("alias").notNull(),
  source: text("source").notNull().default("MANUAL"),
  createdBy: integer("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("entity_alias_company_type_idx").on(table.companyId, table.entityType, table.alias)]);

export const importStagingRows = pgTable("import_staging_rows", {
  id: serial("id").primaryKey(),
  batchId: integer("batch_id").notNull().references(() => importBatches.id),
  sheetId: integer("sheet_id").notNull().references(() => importSheets.id),
  sourceRow: integer("source_row").notNull(),
  rawData: jsonb("raw_data").notNull(),
  normalizedData: jsonb("normalized_data").notNull(),
  issues: jsonb("issues").notNull().default([]),
  duplicateStatus: text("duplicate_status").notNull().default("NEW"),
  duplicateTargetId: integer("duplicate_target_id"),
  action: text("action").notNull().default("CREATE"),
  status: text("status").notNull(),
  targetTable: text("target_table"),
  targetId: integer("target_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("import_staging_batch_row_idx").on(table.batchId, table.sheetId, table.sourceRow)]);

export const importReferenceResolutions = pgTable("import_reference_resolutions", {
  id: serial("id").primaryKey(),
  batchId: integer("batch_id").notNull().references(() => importBatches.id),
  stagingRowId: integer("staging_row_id").notNull().references(() => importStagingRows.id),
  fieldKey: text("field_key").notNull(),
  entityType: text("entity_type").notNull(),
  inputValue: text("input_value").notNull(),
  status: text("status").notNull(),
  resolvedEntityId: integer("resolved_entity_id"),
  candidates: jsonb("candidates").notNull().default([]),
  confirmedBy: integer("confirmed_by").references(() => users.id),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
});

export const importDataLineage = pgTable("import_data_lineage", {
  id: serial("id").primaryKey(),
  batchId: integer("batch_id").notNull().references(() => importBatches.id),
  stagingRowId: integer("staging_row_id").notNull().references(() => importStagingRows.id),
  targetTable: text("target_table").notNull(),
  targetId: integer("target_id").notNull(),
  filename: text("filename").notNull(),
  sheetName: text("sheet_name").notNull(),
  sourceRow: integer("source_row").notNull(),
  rawData: jsonb("raw_data").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("import_lineage_target_idx").on(table.targetTable, table.targetId)]);

export const aiQueries = pgTable("ai_queries", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").references(() => companies.id),
  userId: integer("user_id").notNull().references(() => users.id),
  question: text("question").notNull(),
  answer: jsonb("answer").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const aiConversations = pgTable("ai_conversations", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  companyId: integer("company_id").references(() => companies.id),
  title: text("title").notNull(),
  pageContext: jsonb("page_context").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const aiMessages = pgTable("ai_messages", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id").notNull().references(() => aiConversations.id),
  role: text("role").notNull(),
  content: text("content").notNull(),
  structuredResponse: jsonb("structured_response"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const aiRuns = pgTable("ai_runs", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id").notNull().references(() => aiConversations.id),
  userId: integer("user_id").notNull().references(() => users.id),
  companyId: integer("company_id").references(() => companies.id),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  apiMode: text("api_mode"),
  status: text("status").notNull(),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  totalTokens: integer("total_tokens"),
  latencyMs: integer("latency_ms"),
  errorCode: text("error_code"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
});

export const aiToolCalls = pgTable("ai_tool_calls", {
  id: serial("id").primaryKey(),
  aiRunId: integer("ai_run_id").notNull().references(() => aiRuns.id),
  toolName: text("tool_name").notNull(),
  arguments: jsonb("arguments").notNull().default({}),
  resultSummary: text("result_summary"),
  durationMs: integer("duration_ms").notNull().default(0),
  success: boolean("success").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const aiProviderChecks = pgTable("ai_provider_checks", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  provider: text("provider").notNull(),
  baseUrl: text("base_url").notNull(),
  primaryModel: text("primary_model").notNull(),
  fastModel: text("fast_model").notNull(),
  apiMode: text("api_mode"),
  status: text("status").notNull(),
  latencyMs: integer("latency_ms"),
  errorCode: text("error_code"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type UserRole = "owner" | "finance" | "procurement" | "project_manager" | "designer";
