import "dotenv/config";
import { createServer } from "node:http";
import { directClient, directQuery, ensureDirectDatabase } from "../src/db/direct";

const port = Number(process.env.PGLITE_SERVER_PORT ?? 3199);
let queue: Promise<unknown> = Promise.resolve();

function serial<T>(operation: () => Promise<T>) {
  const result = queue.then(operation, operation);
  queue = result.catch(() => undefined);
  return result;
}

function readBody(request: import("node:http").IncomingMessage) {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    request.on("end", () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")); }
      catch (error) { reject(error); }
    });
    request.on("error", reject);
  });
}

function send(response: import("node:http").ServerResponse, status: number, value: unknown) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(value));
}

async function main() {
  await ensureDirectDatabase();
  const server = createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/health") return send(response, 200, { ok: true, service: "zhiheng-pglite" });
  if (request.method !== "POST") return send(response, 404, { error: "Not found" });
  try {
    const body = await readBody(request);
    if (request.url === "/query") {
      const rows = await serial(() => directQuery(String(body.query ?? ""), Array.isArray(body.params) ? body.params : []));
      return send(response, 200, { rows });
    }
    if (request.url === "/transaction") {
      const statements = Array.isArray(body.statements) ? body.statements as { query: string; params?: unknown[] }[] : [];
      const results = await serial(async () => {
        const output: Record<string, unknown>[][] = [];
        await directClient.exec("BEGIN");
        try {
          for (const statement of statements) {
            const params = (statement.params ?? []).map((param) => {
              if (param && typeof param === "object" && "fromResult" in param && "key" in param) {
                const reference = param as { fromResult: number; row?: number; key: string };
                return output[reference.fromResult]?.[reference.row ?? 0]?.[reference.key];
              }
              return param;
            });
            output.push(await directQuery(statement.query, params));
          }
          await directClient.exec("COMMIT");
          return output;
        } catch (error) { await directClient.exec("ROLLBACK"); throw error; }
      });
      return send(response, 200, { results });
    }
    return send(response, 404, { error: "Not found" });
  } catch (error) {
    console.error("Database request failed:", error);
    return send(response, 400, { error: error instanceof Error ? error.message : "Database error" });
  }
  });

  server.listen(port, "127.0.0.1", () => console.log(`Database service ready on 127.0.0.1:${port}`));
  async function shutdown() { server.close(); await directClient.close(); process.exit(0); }
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
