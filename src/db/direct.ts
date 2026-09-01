import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import * as schema from "./schema";
import { INITIAL_MIGRATION } from "./migration";

const dataDir = process.env.PGLITE_DATA_DIR ?? "./data/finance-db";
mkdirSync(dirname(resolve(dataDir)), { recursive: true });

export const directClient = new PGlite(dataDir);
export const directDb = drizzle(directClient, { schema });
let ready: Promise<void> | null = null;

export async function ensureDirectDatabase() {
  ready ??= directClient.exec(INITIAL_MIGRATION).then(() => undefined);
  await ready;
}

export async function directQuery<T extends Record<string, unknown> = Record<string, unknown>>(query: string, params: unknown[] = []) {
  await ensureDirectDatabase();
  const result = await directClient.query<T>(query, params);
  const numericFields = new Set(result.fields.filter((field) => field.dataTypeID === 1700).map((field) => field.name));
  return result.rows.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, numericFields.has(key) && typeof value === "string" ? Number(value) : value])) as T);
}
