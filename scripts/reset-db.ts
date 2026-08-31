import "dotenv/config";
import { directClient as client } from "../src/db/direct";
import { INITIAL_MIGRATION } from "../src/db/migration";

async function reset() {
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
