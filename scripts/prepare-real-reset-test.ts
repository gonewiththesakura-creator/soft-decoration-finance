import "dotenv/config";
import { directClient, directQuery, ensureDirectDatabase } from "../src/db/direct";

async function main() {
  await ensureDirectDatabase();
  await directQuery("INSERT INTO companies(code,name,status) VALUES('RESET-TEST','Reset Test Company','active')");
  await directClient.close();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
