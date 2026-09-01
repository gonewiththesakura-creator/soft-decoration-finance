CREATE TABLE IF NOT EXISTS invoice_allocations (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id),
  project_id integer NOT NULL REFERENCES projects(id),
  invoice_id integer NOT NULL REFERENCES invoices(id),
  payable_id integer REFERENCES payables(id),
  receivable_plan_id integer REFERENCES receivable_plans(id),
  amount_cents numeric(18,0) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by integer,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by integer,
  CHECK ((payable_id IS NOT NULL)::int + (receivable_plan_id IS NOT NULL)::int = 1)
);
CREATE INDEX IF NOT EXISTS invoice_allocations_invoice_idx ON invoice_allocations(invoice_id);
CREATE INDEX IF NOT EXISTS invoice_allocations_payable_idx ON invoice_allocations(payable_id);
CREATE INDEX IF NOT EXISTS invoice_allocations_receivable_idx ON invoice_allocations(receivable_plan_id);
