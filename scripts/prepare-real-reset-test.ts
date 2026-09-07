import "dotenv/config";
import { directClient, directQuery, ensureDirectDatabase } from "../src/db/direct";

async function main() {
  await ensureDirectDatabase();
  await directQuery("INSERT INTO companies(code,name,status) VALUES('RESET-DEMO-1','Demo Company 1','active'),('RESET-DEMO-2','Demo Company 2','active'),('RESET-DEMO-3','Demo Company 3','active')");
  await directQuery("INSERT INTO real_data_ingest_requests(idempotency_key,remote_ip,status,http_status,response,completed_at) VALUES('reset-test','127.0.0.1','COMPLETED',200,'{\"ok\":true}'::jsonb,now())");
  await directClient.close();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
