import "dotenv/config";
import { directClient, directQuery, ensureDirectDatabase } from "../src/db/direct";

const businessTables = ["companies", "company_accounts", "customers", "suppliers", "projects", "skus", "purchase_orders", "payables", "payments", "receipts", "invoices"];

async function main() {
  await ensureDirectDatabase();
  const [owners] = await directQuery<{ count: number }>("SELECT count(*)::int AS count FROM users WHERE role='owner' AND status='active'");
  if (Number(owners.count) !== 1) throw new Error(`Expected one base owner, found ${owners.count}`);
  for (const table of businessTables) {
    const [row] = await directQuery<{ count: number }>(`SELECT count(*)::int AS count FROM ${table}`);
    if (Number(row.count) !== 0) throw new Error(`Real bootstrap inserted business data into ${table}`);
  }
  console.log("Real-mode bootstrap verified: one owner, zero business records.");
  await directClient.close();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
