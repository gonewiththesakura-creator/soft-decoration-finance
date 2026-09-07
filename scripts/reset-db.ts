import "dotenv/config";
import { directClient as client } from "../src/db/direct";
import { INITIAL_MIGRATION } from "../src/db/migration";
import { getDataMode } from "../src/lib/data-mode";

async function reset() {
  if (getDataMode() !== "demo") throw new Error("Schema reset is restricted to DATA_MODE=demo. Use npm run data:reset-real for a backed-up real-data reset.");
  const target = process.env.PGLITE_DATA_DIR ?? "./data/finance-db";
  if (!target.includes("finance-db")) throw new Error(`Refusing to reset unexpected database target: ${target}`);
  await client.exec("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await client.exec(INITIAL_MIGRATION);
  console.log(`Reset complete: ${target}`);
}

reset().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
