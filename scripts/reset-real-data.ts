import "dotenv/config";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { getDataMode } from "../src/lib/data-mode";

const confirmation = "RESET_TO_REAL_DATA";
const businessTables = [
  "companies", "company_accounts", "customers", "suppliers", "projects", "project_members",
  "project_budget_versions", "project_changes", "contracts", "receivable_plans", "receipts", "skus",
  "supplier_quotes", "purchase_requests", "purchase_request_items", "purchase_approvals", "purchase_orders",
  "goods_receipts", "purchase_returns", "payables", "payment_requests", "payment_approvals", "payments",
  "invoices", "invoice_allocations", "inventory_batches", "inventory_transactions", "shareholder_advances",
] as const;

const truncateTables = [
  ...businessTables.filter((table) => table !== "companies"),
  "audit_logs", "attachments", "login_attempts", "import_jobs", "import_mapping_templates", "import_batches",
  "import_files", "import_sheets", "entity_aliases", "import_staging_rows", "import_reference_resolutions",
  "import_data_lineage", "import_source_groups", "field_aliases", "import_business_facts",
  "import_business_fact_evidence", "ai_queries", "ai_conversations", "ai_messages", "ai_runs", "ai_tool_calls",
  "ai_provider_checks",
] as const;

async function assertDatabaseServiceStopped() {
  const port = Number(process.env.PGLITE_SERVER_PORT ?? 3199);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(800) });
    if (response.ok) throw new Error(`Database service is still running on port ${port}. Stop the app before resetting.`);
  } catch (error) {
    if (error instanceof Error && error.message.includes("still running")) throw error;
  }
}

async function main() {
  if (getDataMode() !== "real") throw new Error("data:reset-real only runs with DATA_MODE=real.");
  await assertDatabaseServiceStopped();
  const { directClient, directQuery, ensureDirectDatabase } = await import("../src/db/direct");
  await ensureDirectDatabase();

  const [owner] = await directQuery<{ id: number; email: string }>("SELECT id,email FROM users WHERE role='owner' ORDER BY id LIMIT 1");
  if (!owner) throw new Error("No owner account exists. Run npm run db:bootstrap first.");
  const counts = Object.fromEntries(await Promise.all(businessTables.map(async (table) => {
    const [row] = await directQuery<{ count: number }>(`SELECT count(*)::int AS count FROM ${table}`);
    return [table, Number(row.count)] as const;
  })));

  console.table(counts);
  const prompt = createInterface({ input, output });
  const answer = await prompt.question(`Type ${confirmation} to back up and remove all business/import data: `);
  prompt.close();
  if (answer.trim() !== confirmation) {
    await directClient.close();
    throw new Error("Confirmation did not match. No data was changed.");
  }

  const stamp = new Date().toISOString().replaceAll(":", "-").replace(".", "-");
  const backupDir = resolve(process.env.REAL_DATA_BACKUP_DIR ?? "backups", `real-reset-${stamp}`);
  await mkdir(backupDir, { recursive: true });
  const archive = await directClient.dumpDataDir("gzip");
  const bytes = Buffer.from(await archive.arrayBuffer());
  await writeFile(resolve(backupDir, "pglite-backup.tar.gz"), bytes);
  const manifest = {
    createdAt: new Date().toISOString(),
    dataMode: "real",
    databasePath: resolve(process.env.PGLITE_DATA_DIR ?? "./data/finance-db"),
    retainedOwner: owner.email,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    counts,
  };
  await writeFile(resolve(backupDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  await directClient.exec("BEGIN");
  try {
    await directClient.exec(`TRUNCATE TABLE ${truncateTables.join(", ")} RESTART IDENTITY CASCADE`);
    await directQuery("UPDATE users SET company_id=NULL WHERE id=$1", [owner.id]);
    await directQuery("DELETE FROM users WHERE id<>$1", [owner.id]);
    await directQuery("DELETE FROM companies");
    await directClient.exec("COMMIT");
  } catch (error) {
    await directClient.exec("ROLLBACK");
    throw error;
  }

  const remaining = Object.fromEntries(await Promise.all(businessTables.map(async (table) => {
    const [row] = await directQuery<{ count: number }>(`SELECT count(*)::int AS count FROM ${table}`);
    return [table, Number(row.count)] as const;
  })));
  const notEmpty = Object.entries(remaining).filter(([, count]) => count !== 0);
  if (notEmpty.length) throw new Error(`Reset verification failed: ${notEmpty.map(([table, count]) => `${table}=${count}`).join(", ")}`);
  console.log(`Real-data reset complete. Backup: ${backupDir}`);
  await directClient.close();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
