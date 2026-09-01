const BASE_SCHEMA = String.raw`
CREATE TABLE IF NOT EXISTS companies (id serial PRIMARY KEY, code text UNIQUE NOT NULL, name text NOT NULL, legal_representative text, status text NOT NULL DEFAULT 'active', created_at timestamptz NOT NULL DEFAULT now(), created_by integer, updated_at timestamptz NOT NULL DEFAULT now(), updated_by integer);
CREATE TABLE IF NOT EXISTS users (id serial PRIMARY KEY, company_id integer REFERENCES companies(id), name text NOT NULL, email text UNIQUE NOT NULL, password_hash text NOT NULL, role text NOT NULL, status text NOT NULL DEFAULT 'active', created_at timestamptz NOT NULL DEFAULT now(), created_by integer, updated_at timestamptz NOT NULL DEFAULT now(), updated_by integer);
CREATE TABLE IF NOT EXISTS company_accounts (id serial PRIMARY KEY, company_id integer NOT NULL REFERENCES companies(id), name text NOT NULL, type text NOT NULL, bank text, last_four text, balance_cents integer NOT NULL DEFAULT 0, status text NOT NULL DEFAULT 'active', note text, created_at timestamptz NOT NULL DEFAULT now(), created_by integer, updated_at timestamptz NOT NULL DEFAULT now(), updated_by integer);
CREATE TABLE IF NOT EXISTS customers (id serial PRIMARY KEY, company_id integer NOT NULL REFERENCES companies(id), code text NOT NULL, name text NOT NULL, type text NOT NULL DEFAULT '企业客户', contact text, phone text, status text NOT NULL DEFAULT 'active', created_at timestamptz NOT NULL DEFAULT now(), created_by integer, updated_at timestamptz NOT NULL DEFAULT now(), updated_by integer, UNIQUE(company_id, code));
CREATE TABLE IF NOT EXISTS suppliers (id serial PRIMARY KEY, company_id integer NOT NULL REFERENCES companies(id), code text NOT NULL, name text NOT NULL, category text NOT NULL, contact text, phone text, tax_number text, status text NOT NULL DEFAULT 'active', created_at timestamptz NOT NULL DEFAULT now(), created_by integer, updated_at timestamptz NOT NULL DEFAULT now(), updated_by integer, UNIQUE(company_id, code));
CREATE TABLE IF NOT EXISTS projects (id serial PRIMARY KEY, company_id integer NOT NULL REFERENCES companies(id), customer_id integer NOT NULL REFERENCES customers(id), code text UNIQUE NOT NULL, name text NOT NULL, address text, owner_id integer REFERENCES users(id), manager_id integer REFERENCES users(id), designer_id integer REFERENCES users(id), original_contract_cents integer NOT NULL DEFAULT 0, current_contract_cents integer NOT NULL DEFAULT 0, budget_cents integer NOT NULL DEFAULT 0, start_date timestamptz, expected_end_date timestamptz, accepted_at timestamptz, warranty_end_date timestamptz, audit_status text NOT NULL DEFAULT '未开始', status text NOT NULL DEFAULT '待启动', note text, created_at timestamptz NOT NULL DEFAULT now(), created_by integer, updated_at timestamptz NOT NULL DEFAULT now(), updated_by integer);
CREATE TABLE IF NOT EXISTS project_members (id serial PRIMARY KEY, project_id integer NOT NULL REFERENCES projects(id), user_id integer NOT NULL REFERENCES users(id), responsibility text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), created_by integer, updated_at timestamptz NOT NULL DEFAULT now(), updated_by integer, UNIQUE(project_id, user_id));
CREATE TABLE IF NOT EXISTS project_budget_versions (id serial PRIMARY KEY, company_id integer NOT NULL REFERENCES companies(id), project_id integer NOT NULL REFERENCES projects(id), version integer NOT NULL, type text NOT NULL, amount_cents integer NOT NULL, status text NOT NULL DEFAULT '已生效', note text, created_at timestamptz NOT NULL DEFAULT now(), created_by integer, updated_at timestamptz NOT NULL DEFAULT now(), updated_by integer, UNIQUE(project_id, version));
CREATE TABLE IF NOT EXISTS project_changes (id serial PRIMARY KEY, company_id integer NOT NULL REFERENCES companies(id), project_id integer NOT NULL REFERENCES projects(id), number text UNIQUE NOT NULL, type text NOT NULL, original_cents integer NOT NULL, adjustment_cents integer NOT NULL, new_cents integer NOT NULL, reason text NOT NULL, applicant_id integer NOT NULL REFERENCES users(id), approver_id integer REFERENCES users(id), status text NOT NULL DEFAULT '待审批', created_at timestamptz NOT NULL DEFAULT now(), created_by integer, updated_at timestamptz NOT NULL DEFAULT now(), updated_by integer);
CREATE TABLE IF NOT EXISTS contracts (id serial PRIMARY KEY, company_id integer NOT NULL REFERENCES companies(id), project_id integer NOT NULL REFERENCES projects(id), number text UNIQUE NOT NULL, name text NOT NULL, amount_cents integer NOT NULL, signed_at timestamptz, status text NOT NULL DEFAULT '生效中', version integer NOT NULL DEFAULT 1, is_void boolean NOT NULL DEFAULT false, void_reason text, created_at timestamptz NOT NULL DEFAULT now(), created_by integer, updated_at timestamptz NOT NULL DEFAULT now(), updated_by integer);
CREATE TABLE IF NOT EXISTS receivable_plans (id serial PRIMARY KEY, company_id integer NOT NULL REFERENCES companies(id), project_id integer NOT NULL REFERENCES projects(id), contract_id integer NOT NULL REFERENCES contracts(id), node_name text NOT NULL, ratio_bps integer NOT NULL, amount_cents integer NOT NULL, received_cents integer NOT NULL DEFAULT 0, due_date timestamptz NOT NULL, is_warranty boolean NOT NULL DEFAULT false, status text NOT NULL DEFAULT '未到期', note text, version integer NOT NULL DEFAULT 1, is_void boolean NOT NULL DEFAULT false, void_reason text, created_at timestamptz NOT NULL DEFAULT now(), created_by integer, updated_at timestamptz NOT NULL DEFAULT now(), updated_by integer);
CREATE TABLE IF NOT EXISTS receipts (id serial PRIMARY KEY, company_id integer NOT NULL REFERENCES companies(id), project_id integer NOT NULL REFERENCES projects(id), receivable_plan_id integer NOT NULL REFERENCES receivable_plans(id), account_id integer REFERENCES company_accounts(id), number text UNIQUE NOT NULL, amount_cents integer NOT NULL, received_at timestamptz NOT NULL, method text NOT NULL DEFAULT '银行转账', status text NOT NULL DEFAULT '已确认', version integer NOT NULL DEFAULT 1, is_void boolean NOT NULL DEFAULT false, void_reason text, created_at timestamptz NOT NULL DEFAULT now(), created_by integer, updated_at timestamptz NOT NULL DEFAULT now(), updated_by integer);
CREATE TABLE IF NOT EXISTS skus (id serial PRIMARY KEY, company_id integer NOT NULL REFERENCES companies(id), project_id integer NOT NULL REFERENCES projects(id), code text NOT NULL, room text, category text NOT NULL, name text NOT NULL, brand text, model text, specification text, material text, color text, quantity integer NOT NULL, unit text NOT NULL, budget_unit_cents integer NOT NULL, final_unit_cents integer, supplier_id integer REFERENCES suppliers(id), tax_rate_bps integer NOT NULL DEFAULT 1300, freight_cents integer NOT NULL DEFAULT 0, install_cents integer NOT NULL DEFAULT 0, lead_days integer, status text NOT NULL DEFAULT '待询价', note text, created_at timestamptz NOT NULL DEFAULT now(), created_by integer, updated_at timestamptz NOT NULL DEFAULT now(), updated_by integer);
CREATE TABLE IF NOT EXISTS supplier_quotes (id serial PRIMARY KEY, company_id integer NOT NULL REFERENCES companies(id), project_id integer NOT NULL REFERENCES projects(id), sku_id integer NOT NULL REFERENCES skus(id), supplier_id integer NOT NULL REFERENCES suppliers(id), unit_price_cents integer NOT NULL, tax_included boolean NOT NULL DEFAULT true, tax_rate_bps integer NOT NULL DEFAULT 1300, freight_cents integer NOT NULL DEFAULT 0, install_cents integer NOT NULL DEFAULT 0, lead_days integer NOT NULL, valid_until timestamptz, payment_terms text, status text NOT NULL DEFAULT '待核价', created_at timestamptz NOT NULL DEFAULT now(), created_by integer, updated_at timestamptz NOT NULL DEFAULT now(), updated_by integer);
CREATE TABLE IF NOT EXISTS purchase_requests (id serial PRIMARY KEY, company_id integer NOT NULL REFERENCES companies(id), project_id integer NOT NULL REFERENCES projects(id), number text UNIQUE NOT NULL, supplier_id integer NOT NULL REFERENCES suppliers(id), payment_type text NOT NULL DEFAULT '对公', amount_cents integer NOT NULL, requested_by integer NOT NULL REFERENCES users(id), status text NOT NULL DEFAULT '草稿', reason text, version integer NOT NULL DEFAULT 1, is_void boolean NOT NULL DEFAULT false, void_reason text, created_at timestamptz NOT NULL DEFAULT now(), created_by integer, updated_at timestamptz NOT NULL DEFAULT now(), updated_by integer);
CREATE TABLE IF NOT EXISTS purchase_request_items (id serial PRIMARY KEY, request_id integer NOT NULL REFERENCES purchase_requests(id), sku_id integer NOT NULL REFERENCES skus(id), quote_id integer REFERENCES supplier_quotes(id), quantity integer NOT NULL, unit_price_cents integer NOT NULL, amount_cents integer NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), created_by integer, updated_at timestamptz NOT NULL DEFAULT now(), updated_by integer);
CREATE TABLE IF NOT EXISTS purchase_approvals (id serial PRIMARY KEY, company_id integer NOT NULL REFERENCES companies(id), project_id integer NOT NULL REFERENCES projects(id), request_id integer NOT NULL REFERENCES purchase_requests(id), approver_id integer NOT NULL REFERENCES users(id), decision text NOT NULL, comment text, decided_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS purchase_orders (id serial PRIMARY KEY, company_id integer NOT NULL REFERENCES companies(id), project_id integer NOT NULL REFERENCES projects(id), request_id integer NOT NULL REFERENCES purchase_requests(id), supplier_id integer NOT NULL REFERENCES suppliers(id), number text UNIQUE NOT NULL, amount_cents integer NOT NULL, delivered_cents integer NOT NULL DEFAULT 0, status text NOT NULL DEFAULT '已下单', ordered_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1, is_void boolean NOT NULL DEFAULT false, void_reason text, created_at timestamptz NOT NULL DEFAULT now(), created_by integer, updated_at timestamptz NOT NULL DEFAULT now(), updated_by integer);
CREATE TABLE IF NOT EXISTS goods_receipts (id serial PRIMARY KEY, company_id integer NOT NULL REFERENCES companies(id), project_id integer NOT NULL REFERENCES projects(id), purchase_order_id integer NOT NULL REFERENCES purchase_orders(id), number text UNIQUE NOT NULL, quantity integer NOT NULL, amount_cents integer NOT NULL, destination text NOT NULL DEFAULT '项目直送', received_at timestamptz NOT NULL, status text NOT NULL DEFAULT '已验收', version integer NOT NULL DEFAULT 1, is_void boolean NOT NULL DEFAULT false, void_reason text, created_at timestamptz NOT NULL DEFAULT now(), created_by integer, updated_at timestamptz NOT NULL DEFAULT now(), updated_by integer);
CREATE TABLE IF NOT EXISTS payables (id serial PRIMARY KEY, company_id integer NOT NULL REFERENCES companies(id), project_id integer NOT NULL REFERENCES projects(id), supplier_id integer NOT NULL REFERENCES suppliers(id), purchase_order_id integer NOT NULL REFERENCES purchase_orders(id), number text UNIQUE NOT NULL, amount_cents integer NOT NULL, paid_cents integer NOT NULL DEFAULT 0, due_date timestamptz NOT NULL, payment_node text NOT NULL, invoice_status text NOT NULL DEFAULT '欠票', status text NOT NULL DEFAULT '待付', note text, version integer NOT NULL DEFAULT 1, is_void boolean NOT NULL DEFAULT false, void_reason text, created_at timestamptz NOT NULL DEFAULT now(), created_by integer, updated_at timestamptz NOT NULL DEFAULT now(), updated_by integer);
CREATE TABLE IF NOT EXISTS purchase_returns (id serial PRIMARY KEY, company_id integer NOT NULL REFERENCES companies(id), project_id integer NOT NULL REFERENCES projects(id), purchase_order_id integer NOT NULL REFERENCES purchase_orders(id), payable_id integer REFERENCES payables(id), number text UNIQUE NOT NULL, type text NOT NULL DEFAULT '退货', amount_cents integer NOT NULL, reason text NOT NULL, status text NOT NULL DEFAULT '已完成', version integer NOT NULL DEFAULT 1, is_void boolean NOT NULL DEFAULT false, void_reason text, created_at timestamptz NOT NULL DEFAULT now(), created_by integer, updated_at timestamptz NOT NULL DEFAULT now(), updated_by integer);
CREATE TABLE IF NOT EXISTS payment_requests (id serial PRIMARY KEY, company_id integer NOT NULL REFERENCES companies(id), project_id integer NOT NULL REFERENCES projects(id), payable_id integer NOT NULL REFERENCES payables(id), number text UNIQUE NOT NULL, amount_cents integer NOT NULL, account_id integer REFERENCES company_accounts(id), requested_by integer NOT NULL REFERENCES users(id), status text NOT NULL DEFAULT '待审批', reason text, version integer NOT NULL DEFAULT 1, is_void boolean NOT NULL DEFAULT false, void_reason text, created_at timestamptz NOT NULL DEFAULT now(), created_by integer, updated_at timestamptz NOT NULL DEFAULT now(), updated_by integer);
CREATE TABLE IF NOT EXISTS payment_approvals (id serial PRIMARY KEY, company_id integer NOT NULL REFERENCES companies(id), project_id integer NOT NULL REFERENCES projects(id), payment_request_id integer NOT NULL REFERENCES payment_requests(id), approver_id integer NOT NULL REFERENCES users(id), decision text NOT NULL, comment text, decided_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS payments (id serial PRIMARY KEY, company_id integer NOT NULL REFERENCES companies(id), project_id integer NOT NULL REFERENCES projects(id), payable_id integer NOT NULL REFERENCES payables(id), payment_request_id integer REFERENCES payment_requests(id), account_id integer REFERENCES company_accounts(id), number text UNIQUE NOT NULL, amount_cents integer NOT NULL, paid_at timestamptz NOT NULL, method text NOT NULL, status text NOT NULL DEFAULT '已付款', version integer NOT NULL DEFAULT 1, is_void boolean NOT NULL DEFAULT false, void_reason text, created_at timestamptz NOT NULL DEFAULT now(), created_by integer, updated_at timestamptz NOT NULL DEFAULT now(), updated_by integer);
CREATE TABLE IF NOT EXISTS invoices (id serial PRIMARY KEY, company_id integer NOT NULL REFERENCES companies(id), project_id integer NOT NULL REFERENCES projects(id), customer_id integer REFERENCES customers(id), supplier_id integer REFERENCES suppliers(id), number text NOT NULL, direction text NOT NULL, type text NOT NULL, amount_cents integer NOT NULL, issued_at timestamptz NOT NULL, status text NOT NULL DEFAULT '正常', version integer NOT NULL DEFAULT 1, is_void boolean NOT NULL DEFAULT false, void_reason text, created_at timestamptz NOT NULL DEFAULT now(), created_by integer, updated_at timestamptz NOT NULL DEFAULT now(), updated_by integer);
CREATE TABLE IF NOT EXISTS inventory_batches (id serial PRIMARY KEY, company_id integer NOT NULL REFERENCES companies(id), project_id integer NOT NULL REFERENCES projects(id), sku_id integer NOT NULL REFERENCES skus(id), purchase_order_id integer REFERENCES purchase_orders(id), batch_number text UNIQUE NOT NULL, quantity integer NOT NULL, remaining_quantity integer NOT NULL, unit_cost_cents integer NOT NULL, status text NOT NULL DEFAULT '在库', created_at timestamptz NOT NULL DEFAULT now(), created_by integer, updated_at timestamptz NOT NULL DEFAULT now(), updated_by integer);
CREATE TABLE IF NOT EXISTS inventory_transactions (id serial PRIMARY KEY, company_id integer NOT NULL REFERENCES companies(id), project_id integer NOT NULL REFERENCES projects(id), batch_id integer NOT NULL REFERENCES inventory_batches(id), type text NOT NULL, quantity integer NOT NULL, amount_cents integer NOT NULL, happened_at timestamptz NOT NULL, note text, created_at timestamptz NOT NULL DEFAULT now(), created_by integer, updated_at timestamptz NOT NULL DEFAULT now(), updated_by integer);
CREATE TABLE IF NOT EXISTS shareholder_advances (id serial PRIMARY KEY, company_id integer NOT NULL REFERENCES companies(id), project_id integer REFERENCES projects(id), person_name text NOT NULL, type text NOT NULL, amount_cents integer NOT NULL, happened_at timestamptz NOT NULL, status text NOT NULL DEFAULT '未归还', note text, version integer NOT NULL DEFAULT 1, is_void boolean NOT NULL DEFAULT false, void_reason text, created_at timestamptz NOT NULL DEFAULT now(), created_by integer, updated_at timestamptz NOT NULL DEFAULT now(), updated_by integer);
CREATE TABLE IF NOT EXISTS audit_logs (id serial PRIMARY KEY, company_id integer REFERENCES companies(id), project_id integer REFERENCES projects(id), user_id integer REFERENCES users(id), object_type text NOT NULL, object_id integer, action text NOT NULL, before jsonb, after jsonb, ip text, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS import_jobs (id serial PRIMARY KEY, company_id integer NOT NULL REFERENCES companies(id), user_id integer NOT NULL REFERENCES users(id), resource text NOT NULL, filename text NOT NULL, total_rows integer NOT NULL, success_rows integer NOT NULL DEFAULT 0, error_rows integer NOT NULL DEFAULT 0, status text NOT NULL, errors jsonb, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS ai_queries (id serial PRIMARY KEY, company_id integer REFERENCES companies(id), user_id integer NOT NULL REFERENCES users(id), question text NOT NULL, answer jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS projects_company_idx ON projects(company_id);
CREATE INDEX IF NOT EXISTS receivables_scope_idx ON receivable_plans(company_id, project_id, due_date);
CREATE INDEX IF NOT EXISTS skus_scope_idx ON skus(company_id, project_id);
CREATE INDEX IF NOT EXISTS purchase_requests_scope_idx ON purchase_requests(company_id, project_id, status);
CREATE INDEX IF NOT EXISTS payables_scope_idx ON payables(company_id, project_id, due_date);
CREATE INDEX IF NOT EXISTS audit_logs_scope_idx ON audit_logs(company_id, project_id, created_at);
`;

export const FINANCIAL_NUMERIC_MIGRATION = String.raw`
CREATE TABLE IF NOT EXISTS schema_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0001_financial_numeric') THEN
    ALTER TABLE company_accounts ALTER COLUMN balance_cents TYPE numeric(18,0) USING balance_cents::numeric(18,0);
    ALTER TABLE projects ALTER COLUMN original_contract_cents TYPE numeric(18,0) USING original_contract_cents::numeric(18,0), ALTER COLUMN current_contract_cents TYPE numeric(18,0) USING current_contract_cents::numeric(18,0), ALTER COLUMN budget_cents TYPE numeric(18,0) USING budget_cents::numeric(18,0);
    ALTER TABLE project_budget_versions ALTER COLUMN amount_cents TYPE numeric(18,0) USING amount_cents::numeric(18,0);
    ALTER TABLE project_changes ALTER COLUMN original_cents TYPE numeric(18,0) USING original_cents::numeric(18,0), ALTER COLUMN adjustment_cents TYPE numeric(18,0) USING adjustment_cents::numeric(18,0), ALTER COLUMN new_cents TYPE numeric(18,0) USING new_cents::numeric(18,0);
    ALTER TABLE contracts ALTER COLUMN amount_cents TYPE numeric(18,0) USING amount_cents::numeric(18,0);
    ALTER TABLE receivable_plans ALTER COLUMN amount_cents TYPE numeric(18,0) USING amount_cents::numeric(18,0), ALTER COLUMN received_cents TYPE numeric(18,0) USING received_cents::numeric(18,0);
    ALTER TABLE receipts ALTER COLUMN amount_cents TYPE numeric(18,0) USING amount_cents::numeric(18,0);
    ALTER TABLE skus ALTER COLUMN quantity TYPE numeric(18,4) USING quantity::numeric(18,4), ALTER COLUMN budget_unit_cents TYPE numeric(18,0) USING budget_unit_cents::numeric(18,0), ALTER COLUMN final_unit_cents TYPE numeric(18,0) USING final_unit_cents::numeric(18,0), ALTER COLUMN freight_cents TYPE numeric(18,0) USING freight_cents::numeric(18,0), ALTER COLUMN install_cents TYPE numeric(18,0) USING install_cents::numeric(18,0);
    ALTER TABLE supplier_quotes ALTER COLUMN unit_price_cents TYPE numeric(18,0) USING unit_price_cents::numeric(18,0), ALTER COLUMN freight_cents TYPE numeric(18,0) USING freight_cents::numeric(18,0), ALTER COLUMN install_cents TYPE numeric(18,0) USING install_cents::numeric(18,0);
    ALTER TABLE purchase_requests ALTER COLUMN amount_cents TYPE numeric(18,0) USING amount_cents::numeric(18,0);
    ALTER TABLE purchase_request_items ALTER COLUMN quantity TYPE numeric(18,4) USING quantity::numeric(18,4), ALTER COLUMN unit_price_cents TYPE numeric(18,0) USING unit_price_cents::numeric(18,0), ALTER COLUMN amount_cents TYPE numeric(18,0) USING amount_cents::numeric(18,0);
    ALTER TABLE purchase_orders ALTER COLUMN amount_cents TYPE numeric(18,0) USING amount_cents::numeric(18,0), ALTER COLUMN delivered_cents TYPE numeric(18,0) USING delivered_cents::numeric(18,0);
    ALTER TABLE goods_receipts ALTER COLUMN quantity TYPE numeric(18,4) USING quantity::numeric(18,4), ALTER COLUMN amount_cents TYPE numeric(18,0) USING amount_cents::numeric(18,0);
    ALTER TABLE purchase_returns ADD COLUMN IF NOT EXISTS quantity numeric(18,4) NOT NULL DEFAULT 0;
    ALTER TABLE purchase_returns ALTER COLUMN quantity TYPE numeric(18,4) USING quantity::numeric(18,4), ALTER COLUMN amount_cents TYPE numeric(18,0) USING amount_cents::numeric(18,0);
    ALTER TABLE payables ALTER COLUMN amount_cents TYPE numeric(18,0) USING amount_cents::numeric(18,0), ALTER COLUMN paid_cents TYPE numeric(18,0) USING paid_cents::numeric(18,0);
    ALTER TABLE payment_requests ALTER COLUMN amount_cents TYPE numeric(18,0) USING amount_cents::numeric(18,0);
    ALTER TABLE payments ALTER COLUMN amount_cents TYPE numeric(18,0) USING amount_cents::numeric(18,0);
    ALTER TABLE invoices ALTER COLUMN amount_cents TYPE numeric(18,0) USING amount_cents::numeric(18,0);
    ALTER TABLE inventory_batches ALTER COLUMN quantity TYPE numeric(18,4) USING quantity::numeric(18,4), ALTER COLUMN remaining_quantity TYPE numeric(18,4) USING remaining_quantity::numeric(18,4), ALTER COLUMN unit_cost_cents TYPE numeric(18,0) USING unit_cost_cents::numeric(18,0);
    ALTER TABLE inventory_transactions ALTER COLUMN quantity TYPE numeric(18,4) USING quantity::numeric(18,4), ALTER COLUMN amount_cents TYPE numeric(18,0) USING amount_cents::numeric(18,0);
    ALTER TABLE shareholder_advances ALTER COLUMN amount_cents TYPE numeric(18,0) USING amount_cents::numeric(18,0);
    INSERT INTO schema_migrations(version) VALUES ('0001_financial_numeric');
  END IF;
END
$migration$;
`;

export const BUSINESS_ATTACHMENT_MIGRATION = String.raw`
DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0002_business_attachments') THEN
    ALTER TABLE contracts ADD COLUMN IF NOT EXISTS attachment_url text;
    ALTER TABLE receipts ADD COLUMN IF NOT EXISTS bank_receipt_url text;
    ALTER TABLE skus ADD COLUMN IF NOT EXISTS image_url text;
    ALTER TABLE supplier_quotes ADD COLUMN IF NOT EXISTS attachment_url text;
    ALTER TABLE purchase_requests ADD COLUMN IF NOT EXISTS attachment_url text;
    ALTER TABLE payments ADD COLUMN IF NOT EXISTS bank_receipt_url text;
    INSERT INTO schema_migrations(version) VALUES ('0002_business_attachments');
  END IF;
END
$migration$;
`;

export const AUTH_SECURITY_MIGRATION = String.raw`
DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0003_auth_security') THEN
    CREATE TABLE IF NOT EXISTS login_attempts (id serial PRIMARY KEY, email text NOT NULL, ip text NOT NULL, user_id integer REFERENCES users(id), success boolean NOT NULL DEFAULT false, attempted_at timestamptz NOT NULL DEFAULT now());
    CREATE INDEX IF NOT EXISTS login_attempts_rate_idx ON login_attempts(email, ip, attempted_at);
    INSERT INTO schema_migrations(version) VALUES ('0003_auth_security');
  END IF;
END
$migration$;
`;

export const IMPORT_SAFETY_MIGRATION = String.raw`
DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0004_import_safety') THEN
    ALTER TABLE import_jobs ADD COLUMN IF NOT EXISTS source_hash text;
    CREATE UNIQUE INDEX IF NOT EXISTS import_jobs_source_hash_idx ON import_jobs(source_hash) WHERE source_hash IS NOT NULL;
    INSERT INTO schema_migrations(version) VALUES ('0004_import_safety');
  END IF;
END
$migration$;
`;

export const INVOICE_ALLOCATION_MIGRATION = String.raw`
DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0005_invoice_allocations') THEN
    CREATE TABLE IF NOT EXISTS invoice_allocations (id serial PRIMARY KEY, company_id integer NOT NULL REFERENCES companies(id), project_id integer NOT NULL REFERENCES projects(id), invoice_id integer NOT NULL REFERENCES invoices(id), payable_id integer REFERENCES payables(id), receivable_plan_id integer REFERENCES receivable_plans(id), amount_cents numeric(18,0) NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), created_by integer, updated_at timestamptz NOT NULL DEFAULT now(), updated_by integer, CHECK ((payable_id IS NOT NULL)::int + (receivable_plan_id IS NOT NULL)::int = 1));
    CREATE INDEX IF NOT EXISTS invoice_allocations_invoice_idx ON invoice_allocations(invoice_id);
    CREATE INDEX IF NOT EXISTS invoice_allocations_payable_idx ON invoice_allocations(payable_id);
    CREATE INDEX IF NOT EXISTS invoice_allocations_receivable_idx ON invoice_allocations(receivable_plan_id);
    INSERT INTO schema_migrations(version) VALUES ('0005_invoice_allocations');
  END IF;
END
$migration$;
`;

export const ATTACHMENT_SYSTEM_MIGRATION = String.raw`
DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0006_attachment_system') THEN
    CREATE TABLE IF NOT EXISTS attachments (
      id serial PRIMARY KEY,
      company_id integer NOT NULL REFERENCES companies(id),
      project_id integer REFERENCES projects(id),
      object_type text NOT NULL,
      object_id integer NOT NULL,
      category text NOT NULL,
      filename text NOT NULL,
      original_filename text NOT NULL,
      mime_type text NOT NULL,
      file_size integer NOT NULL CHECK (file_size > 0),
      storage_key text NOT NULL UNIQUE,
      url text NOT NULL,
      uploaded_by integer NOT NULL REFERENCES users(id),
      is_void boolean NOT NULL DEFAULT false,
      void_reason text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      updated_by integer
    );
    CREATE INDEX IF NOT EXISTS attachments_object_idx ON attachments(object_type, object_id) WHERE NOT is_void;
    CREATE INDEX IF NOT EXISTS attachments_company_project_idx ON attachments(company_id, project_id);
    INSERT INTO schema_migrations(version) VALUES ('0006_attachment_system');
  END IF;
END
$migration$;
`;

export const DATA_MIGRATION_CENTER_MIGRATION = String.raw`
DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0007_data_migration_center') THEN
    CREATE TABLE import_mapping_templates (id serial PRIMARY KEY, company_id integer REFERENCES companies(id), name text NOT NULL, business_type text NOT NULL, sheet_signature text NOT NULL, source_fields jsonb NOT NULL, field_mappings jsonb NOT NULL, transform_rules jsonb NOT NULL DEFAULT '{}'::jsonb, created_by integer NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), updated_by integer);
    CREATE UNIQUE INDEX import_mapping_template_signature_idx ON import_mapping_templates(company_id, business_type, sheet_signature);
    CREATE TABLE import_batches (id serial PRIMARY KEY, batch_number text NOT NULL UNIQUE, company_id integer REFERENCES companies(id), user_id integer NOT NULL REFERENCES users(id), mode text NOT NULL DEFAULT 'HISTORY', business_type text, source_hash text NOT NULL, mapping_template_id integer REFERENCES import_mapping_templates(id), total_rows integer NOT NULL DEFAULT 0, ready_rows integer NOT NULL DEFAULT 0, warning_rows integer NOT NULL DEFAULT 0, error_rows integer NOT NULL DEFAULT 0, success_rows integer NOT NULL DEFAULT 0, skipped_rows integer NOT NULL DEFAULT 0, status text NOT NULL DEFAULT 'UPLOADED', error_message text, confirmed_at timestamptz, completed_at timestamptz, rolled_back_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
    CREATE INDEX import_batches_scope_idx ON import_batches(company_id, created_at DESC);
    CREATE TABLE import_files (id serial PRIMARY KEY, batch_id integer NOT NULL REFERENCES import_batches(id), filename text NOT NULL, file_size integer NOT NULL, file_hash text NOT NULL, sheet_count integer NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE import_sheets (id serial PRIMARY KEY, batch_id integer NOT NULL REFERENCES import_batches(id), file_id integer NOT NULL REFERENCES import_files(id), sheet_index integer NOT NULL, name text NOT NULL, row_count integer NOT NULL, column_count integer NOT NULL, headers jsonb NOT NULL, preview_rows jsonb NOT NULL, raw_rows jsonb NOT NULL, selected boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(batch_id, sheet_index));
    CREATE TABLE entity_aliases (id serial PRIMARY KEY, company_id integer NOT NULL REFERENCES companies(id), entity_type text NOT NULL, entity_id integer NOT NULL, alias text NOT NULL, source text NOT NULL DEFAULT 'MANUAL', created_by integer NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(company_id, entity_type, alias));
    CREATE TABLE import_staging_rows (id serial PRIMARY KEY, batch_id integer NOT NULL REFERENCES import_batches(id), sheet_id integer NOT NULL REFERENCES import_sheets(id), source_row integer NOT NULL, raw_data jsonb NOT NULL, normalized_data jsonb NOT NULL, issues jsonb NOT NULL DEFAULT '[]'::jsonb, duplicate_status text NOT NULL DEFAULT 'NEW', duplicate_target_id integer, action text NOT NULL DEFAULT 'CREATE', status text NOT NULL, target_table text, target_id integer, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(batch_id, sheet_id, source_row));
    CREATE INDEX import_staging_batch_status_idx ON import_staging_rows(batch_id, status, source_row);
    CREATE TABLE import_reference_resolutions (id serial PRIMARY KEY, batch_id integer NOT NULL REFERENCES import_batches(id), staging_row_id integer NOT NULL REFERENCES import_staging_rows(id), field_key text NOT NULL, entity_type text NOT NULL, input_value text NOT NULL, status text NOT NULL, resolved_entity_id integer, candidates jsonb NOT NULL DEFAULT '[]'::jsonb, confirmed_by integer REFERENCES users(id), confirmed_at timestamptz);
    CREATE INDEX import_resolution_row_idx ON import_reference_resolutions(staging_row_id);
    CREATE TABLE import_data_lineage (id serial PRIMARY KEY, batch_id integer NOT NULL REFERENCES import_batches(id), staging_row_id integer NOT NULL REFERENCES import_staging_rows(id), target_table text NOT NULL, target_id integer NOT NULL, filename text NOT NULL, sheet_name text NOT NULL, source_row integer NOT NULL, raw_data jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(target_table, target_id));
    CREATE INDEX import_lineage_batch_idx ON import_data_lineage(batch_id);
    ALTER TABLE import_jobs ADD COLUMN IF NOT EXISTS migration_batch_id integer REFERENCES import_batches(id);
    ALTER TABLE skus DROP CONSTRAINT IF EXISTS skus_code_key;
    CREATE UNIQUE INDEX IF NOT EXISTS skus_project_code_idx ON skus(project_id,code);
    ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_number_key;
    CREATE UNIQUE INDEX IF NOT EXISTS invoices_company_number_idx ON invoices(company_id,number);
    INSERT INTO schema_migrations(version) VALUES ('0007_data_migration_center');
  END IF;
END
$migration$;
`;

export const IMPORT_SCOPE_MIGRATION = String.raw`
DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0008_import_scope') THEN
    ALTER TABLE import_jobs ADD COLUMN IF NOT EXISTS migration_batch_id integer REFERENCES import_batches(id);
    ALTER TABLE skus DROP CONSTRAINT IF EXISTS skus_code_key;
    CREATE UNIQUE INDEX IF NOT EXISTS skus_project_code_idx ON skus(project_id,code);
    ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_number_key;
    CREATE UNIQUE INDEX IF NOT EXISTS invoices_company_number_idx ON invoices(company_id,number);
    DROP INDEX IF EXISTS import_jobs_source_hash_idx;
    CREATE UNIQUE INDEX import_jobs_source_hash_idx ON import_jobs(source_hash) WHERE source_hash IS NOT NULL AND status='已完成';
    INSERT INTO schema_migrations(version) VALUES ('0008_import_scope');
  END IF;
END
$migration$;
`;

export const INITIAL_MIGRATION = BASE_SCHEMA + FINANCIAL_NUMERIC_MIGRATION + BUSINESS_ATTACHMENT_MIGRATION + AUTH_SECURITY_MIGRATION + IMPORT_SAFETY_MIGRATION + INVOICE_ALLOCATION_MIGRATION + ATTACHMENT_SYSTEM_MIGRATION + DATA_MIGRATION_CENTER_MIGRATION + IMPORT_SCOPE_MIGRATION;
