import { headers } from "next/headers";
import { sqlQuery } from "@/db/client";
import type { SessionUser } from "./auth";

export async function writeAudit(input: {
  user: SessionUser;
  companyId?: number | null;
  projectId?: number | null;
  objectType: string;
  objectId?: number | null;
  action: string;
  before?: unknown;
  after?: unknown;
  ip?: string;
}) {
  let ip = input.ip ?? "127.0.0.1";
  if (!input.ip) {
    try { ip = (await headers()).get("x-forwarded-for")?.split(",")[0] ?? ip; }
    catch { /* Non-request integration tests use the loopback address. */ }
  }
  await sqlQuery(
    `INSERT INTO audit_logs (company_id, project_id, user_id, object_type, object_id, action, before, after, ip)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9)`,
    [input.companyId ?? input.user.companyId, input.projectId ?? null, input.user.id, input.objectType, input.objectId ?? null, input.action, JSON.stringify(input.before ?? null), JSON.stringify(input.after ?? null), ip],
  );
}
