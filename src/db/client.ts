const databaseUrl = `http://127.0.0.1:${process.env.PGLITE_SERVER_PORT ?? "3199"}`;

export type TransactionParam = unknown | { fromResult: number; row?: number; key: string };
export type TransactionStatement = { query: string; params?: TransactionParam[] };

async function requestDatabase<T>(path: string, body: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${databaseUrl}${path}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store",
    });
  } catch {
    throw new Error("本地数据库服务未启动，请使用 npm run dev 或 npm start 启动完整应用");
  }
  const payload = await response.json() as { error?: string } & T;
  if (!response.ok) throw new Error(payload.error ?? "数据库请求失败");
  return payload;
}

export async function ensureDatabase() {
  const response = await fetch(`${databaseUrl}/health`, { cache: "no-store" }).catch(() => null);
  if (!response?.ok) throw new Error("本地数据库服务未启动，请使用 npm run dev 或 npm start 启动完整应用");
}

export async function sqlQuery<T extends Record<string, unknown> = Record<string, unknown>>(query: string, params: unknown[] = []) {
  return (await requestDatabase<{ rows: T[] }>("/query", { query, params })).rows;
}

export async function runTransaction<T extends Record<string, unknown> = Record<string, unknown>>(statements: TransactionStatement[]) {
  return (await requestDatabase<{ results: T[][] }>("/transaction", { statements })).results;
}
