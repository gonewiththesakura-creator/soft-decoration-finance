-- Upgrade financial amounts and physical quantities without losing existing data.
-- The application applies the equivalent idempotent migration from src/db/migration.ts.
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
