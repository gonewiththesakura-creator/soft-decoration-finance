import "dotenv/config";
import { directClient, directQuery, ensureDirectDatabase } from "../src/db/direct";

const businessTables = [
  "companies", "company_accounts", "customers", "suppliers", "projects", "project_members", "project_budget_versions",
  "project_changes", "contracts", "receivable_plans", "receipts", "skus", "supplier_quotes", "purchase_requests",
  "purchase_request_items", "purchase_approvals", "purchase_orders", "goods_receipts", "purchase_returns", "payables",
  "payment_requests", "payment_approvals", "payments", "invoices", "invoice_allocations", "inventory_batches",
  "inventory_transactions", "shareholder_advances",
];
const ingestTables = ["import_batches", "import_files", "import_sheets", "import_staging_rows", "import_data_lineage", "import_business_facts", "real_data_ingest_requests", "real_data_ingest_audit"];

async function main() {
  await ensureDirectDatabase();
  const [owners] = await directQuery<{ count: number }>("SELECT count(*)::int AS count FROM users WHERE role='owner' AND status='active'");
  if (Number(owners.count) !== 1) throw new Error(`Expected one base owner, found ${owners.count}`);
  for (const table of businessTables) {
    const [row] = await directQuery<{ count: number }>(`SELECT count(*)::int AS count FROM ${table}`);
    if (Number(row.count) !== 0) throw new Error(`Real bootstrap inserted business data into ${table}`);
  }
  for (const table of ingestTables) {
    const [row] = await directQuery<{ count: number }>(`SELECT count(*)::int AS count FROM ${table}`);
    if (Number(row.count) !== 0) throw new Error(`Expected no import history in ${table}, found ${row.count}`);
  }
  console.log("Real-mode bootstrap verified: one owner, zero business records and zero import history.");
  await directClient.close();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
