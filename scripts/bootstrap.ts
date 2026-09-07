import "dotenv/config";
import { ensureBaseAdministrator } from "../src/db/bootstrap";
import { directClient } from "../src/db/direct";
import { getDataMode } from "../src/lib/data-mode";

async function main() {
  const result = await ensureBaseAdministrator();
  console.log(`${result.created ? "Created" : "Found"} base owner account ${result.email} in ${getDataMode()} mode.`);
  await directClient.close();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
